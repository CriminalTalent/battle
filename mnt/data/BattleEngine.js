// BattleEngine.js
// Implements PYXIS rules: HP 100 fixed, stats 1~5, actions, D20, crit/evasion, defense stance, items, turn flow.

export default class BattleEngine {
  constructor(battle){
    this.battle = battle;
    this.battle.maxTurns = this.battle.maxTurns || 100;
    this.battle.turn = this.battle.turn || { order:['A','B'], phaseIndex:0, round:1, acted:{A:new Set(),B:new Set()} };
    if(!this.battle.turn.acted?.A) this.battle.turn.acted.A = new Set();
    if(!this.battle.turn.acted?.B) this.battle.turn.acted.B = new Set();
    if(!this.battle.currentTeam) this.battle.currentTeam = this.battle.turn.order[this.battle.turn.phaseIndex % 2];
    if(!this.battle.logs) this.battle.logs = [];
    // team timeLeft (seconds) per spec: 5 minutes
    this.battle.timeLeft = Number.isFinite(this.battle.timeLeft)? this.battle.timeLeft : 300;
  }

  // --- util
  _randD20(){ return Math.floor(Math.random()*20)+1; }
  _clamp(n,min,max){ return Math.max(min, Math.min(max,n)); }
  _readStats(p){
    const s = p?.stats||{};
    return {
      attack: this._clamp(Number(s.attack||0),1,5),
      defense: this._clamp(Number(s.defense||0),1,5),
      agility: this._clamp(Number(s.agility||0),1,5),
      luck: this._clamp(Number(s.luck||0),1,5)
    };
  }

  getAlivePlayersInTeam(team){ return (this.battle.players||[]).filter(p=>p.team===team && p.hp>0); }
  getCurrentActiveTeam(){ return this.battle.currentTeam; }
  getBattleStats(){
    return {
      round: this.battle.turn.round,
      phase: this.battle.turn.phaseIndex % 2 === 0 ? 'A' : 'B',
      activeTeam: this.battle.currentTeam,
      timeLeft: this.battle.timeLeft
    };
  }

  // --- actions
  processAttack(actorId, targetId, logs=[], updates={}){
    const a = (this.battle.players||[]).find(p=>p.id===actorId);
    const t = (this.battle.players||[]).find(p=>p.id===targetId);
    if(!a || !t) { logs.push({type:'error', message:'대상 오류'}); return false; }
    if(a.team===t.team) { logs.push({type:'error', message:'같은 팀은 공격할 수 없습니다'}); return false; }
    if(t.hp<=0){ logs.push({type:'error', message:'쓰러진 대상은 공격할 수 없습니다'}); return false; }

    const sa = this._readStats(a), st = this._readStats(t);
    const atkRoll = sa.attack + this._randD20(); // 1) 공격력 계산
    // 2) 회피 판정
    const evadeRoll = st.agility + this._randD20();
    if(evadeRoll >= atkRoll){
      logs.push({type:'combat', message:`${a.name}의 공격을 ${t.name}이(가) 완전회피!`});
      return true;
    }
    // 3) 치명타
    const isCrit = (this._randD20() >= (20 - sa.luck/2));
    // 4) 피해 계산
    const targetDefend = !!t._defend;
    const attackRoll2 = sa.attack + this._randD20();
    const defenseRoll = st.defense + (targetDefend ? this._randD20() : 0);
    let dmg = attackRoll2 - defenseRoll;
    if(targetDefend) dmg = Math.max(0, dmg); else dmg = Math.max(1, dmg);
    if(isCrit) dmg = dmg * 2;

    t.hp = Math.max(0, (t.hp||0) - dmg);
    if(targetDefend) t._defend = false;
    updates.hp = updates.hp || {}; updates.hp[t.id] = t.hp;

    const critTxt = isCrit ? ' (치명타!)' : '';
    logs.push({type:'combat', message:`${a.name}가 ${t.name}에게 ${dmg} 피해를 입혔습니다${critTxt}`});
    if(t.hp<=0){ logs.push({type:'combat', message:`${t.name} 전투불능!`}); }

    // 기록: 최근 공격자
    this.battle.lastAttackerTeam = a.team;
    return true;
  }

  processDefend(actorId, logs=[]){
    const a = (this.battle.players||[]).find(p=>p.id===actorId);
    if(!a) return false;
    a._defend = true;
    logs.push({type:'combat', message:`${a.name} 방어 태세! 다음 1회 피격 방어 강화`});
    return true;
  }

  processPass(actorId, logs=[]){
    const a = (this.battle.players||[]).find(p=>p.id===actorId);
    if(!a) return false;
    logs.push({type:'system', message:`${a.name} 패스`});
    return true;
  }

  processDodge(actorId, logs=[]){
    const a = (this.battle.players||[]).find(p=>p.id===actorId);
    if(!a) return false;
    a._dodgeReady = true; // 간단 처리
    logs.push({type:'combat', message:`${a.name} 회피 대기`});
    return true;
  }

  processItem(actorId, itemType, targetId, logs=[], updates={}){
    const a = (this.battle.players||[]).find(p=>p.id===actorId);
    if(!a) return false;
    a.items = a.items || { dittany:0, attack_boost:0, defense_boost:0 };
    const t = (this.battle.players||[]).find(p=>p.id===targetId);

    if(itemType==='dittany'){
      const target = t && t.team===a.team ? t : a;
      if((a.items.dittany||0) <= 0){ logs.push({type:'error', message:'디터니가 없습니다'}); return false; }
      a.items.dittany -= 1;
      target.hp = Math.min(target.maxHp||100, (target.hp||0)+10);
      updates.hp = updates.hp || {}; updates.hp[target.id] = target.hp;
      logs.push({type:'heal', message:`${target.name} HP 10 회복`});
      return true;
    }
    if(itemType==='attack_boost'){
      if((a.items.attack_boost||0) <= 0){ logs.push({type:'error', message:'공격 보정기가 없습니다'}); return false; }
      a.items.attack_boost -= 1;
      const ok = Math.random() < 0.10;
      if(ok){ a._atkBoost = true; logs.push({type:'system', message:`공격 보정기 성공: 다음 공격 2배`}); }
      else { logs.push({type:'system', message:`공격 보정기 실패: 아이템 소모됨`}); }
      return true;
    }
    if(itemType==='defense_boost'){
      if((a.items.defense_boost||0) <= 0){ logs.push({type:'error', message:'방어 보정기가 없습니다'}); return false; }
      a.items.defense_boost -= 1;
      const ok = Math.random() < 0.10;
      if(ok){ a._defBoost = true; logs.push({type:'system', message:`방어 보정기 성공: 다음 피격 방어 2배`}); }
      else { logs.push({type:'system', message:`방어 보정기 실패: 아이템 소모됨`}); }
      return true;
    }
    logs.push({type:'error', message:'알 수 없는 아이템'});
    return false;
  }

  recordPlayerAction(playerId){
    const p = (this.battle.players||[]).find(x=>x.id===playerId);
    if(!p) return;
    const acted = this.battle.turn.acted[p.team] || new Set();
    acted.add(p.id);
    this.battle.turn.acted[p.team] = acted;
  }

  advancePhase(){
    const team = this.getCurrentActiveTeam();
    const aliveIds = new Set(this.getAlivePlayersInTeam(team).map(p=>p.id));
    const acted = this.battle.turn.acted[team] || new Set();
    let turnComplete = true;
    for(const id of aliveIds){ if(!acted.has(id)) { turnComplete = false; break; } }
    let phaseComplete = false;
    if(turnComplete){
      this.battle.turn.phaseIndex += 1;
      const newTeam = this.battle.turn.order[this.battle.turn.phaseIndex % 2];
      this.battle.currentTeam = newTeam;
      this.battle.timeLeft = 300;
      phaseComplete = true;
      if(this.battle.turn.phaseIndex % 2 === 0){
        this.battle.turn.round += 1;
        this.battle.turn.acted = {A:new Set(),B:new Set()};
        this.battle.turn.order.reverse();
      }
    }
    return { phaseComplete, turnComplete };
  }

  isBattleOver(){
    const aAlive = this.getAlivePlayersInTeam('A').length;
    const bAlive = this.getAlivePlayersInTeam('B').length;
    if(aAlive===0 || bAlive===0) return true;
    if(this.battle.turn.round>this.battle.maxTurns) return true;
    return false;
  }

  determineWinner(){
    const aAlive = this.getAlivePlayersInTeam('A').length;
    const bAlive = this.getAlivePlayersInTeam('B').length;
    if(aAlive!==bAlive) return aAlive>bAlive?'A':'B';
    const sum = (team)=> (this.battle.players||[]).filter(p=>p.team===team).reduce((s,p)=>s+(p.hp||0),0);
    const hpA = sum('A'), hpB = sum('B');
    if(hpA!==hpB) return hpA>hpB?'A':'B';
    if(this.battle.lastAttackerTeam) return this.battle.lastAttackerTeam;
    if(this.battle.currentTeam) return this.battle.currentTeam;
    const first = this.battle.firstTeam || this.battle.turn?.order?.[0] || 'A';
    if(first) return first;
    const agiSum = (team)=> (this.battle.players||[]).filter(p=>p.team===team).reduce((s,p)=>s+(this._readStats(p).agility||0),0);
    const agA = agiSum('A'), agB = agiSum('B');
    if(agA!==agB) return agA>agB?'A':'B';
    return 'A';
  }
}

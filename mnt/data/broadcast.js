// broadcast.js
// Emits both legacy and new event names to keep clients compatible.
export class BroadcastManager {
  constructor(io){ this.io = io; }
  _rooms(battle){ 
    const id = typeof battle === 'string' ? battle : battle?.id;
    return [`battle-${id}`, id, String(id)];
  }
  _emitRooms(rooms, evt, payload){ rooms.forEach(r=> this.io.to(r).emit(evt, payload)); }

  broadcastBattleUpdate(battle){
    const payload = sanitizeBattle(battle);
    const rooms = this._rooms(battle);
    this._emitRooms(rooms, 'battleUpdate', payload);
    this._emitRooms(rooms, 'battle:update', payload);
  }
  broadcastSystemLog(battleId, log){
    const rooms = this._rooms(battleId);
    this._emitRooms(rooms, 'battleLog', log);
    this._emitRooms(rooms, 'battle:log', log);
  }
  broadcastCombatLog(battleId, logs){
    (logs||[]).forEach(l=> this.broadcastSystemLog(battleId, l));
  }
  broadcastActionResult(battle, action, result){
    const rooms = this._rooms(battle);
    const payload = { type:'action_result', action, result };
    this._emitRooms(rooms, 'actionSuccess', payload);
    this._emitRooms(rooms, 'battle_update', payload);
  }
  broadcastBattleStart(battle, initiative){
    const rooms = this._rooms(battle);
    const payload = { type:'battle_start', initiative };
    this._emitRooms(rooms, 'battleStarted', payload);
    this._emitRooms(rooms, 'battle:started', payload);
    this._emitRooms(rooms, 'battle_start', payload);
  }
  broadcastBattleEnd(battle, endData){
    const rooms = this._rooms(battle);
    this._emitRooms(rooms, 'battle:ended', endData);
    this._emitRooms(rooms, 'battle_end', endData);
  }
  broadcastTurnChange(battle, data){
    const rooms = this._rooms(battle);
    this._emitRooms(rooms, 'turn_change', data);
  }
  broadcastChat(battleId, data){
    const rooms = this._rooms(battleId);
    this._emitRooms(rooms, 'chatMessage', data);
    this._emitRooms(rooms, 'battle:chat', data);
  }
  broadcastSpectatorCount(battleId, count){
    const rooms = this._rooms(battleId);
    this._emitRooms(rooms, 'spectator_count', { count });
  }
}

export function broadcastChat(io, battleId, data){
  const mgr = new BroadcastManager(io); mgr.broadcastChat(battleId, data);
}
export function broadcastSpectatorCount(io, battleId, count){
  const mgr = new BroadcastManager(io); mgr.broadcastSpectatorCount(battleId, count);
}

function sanitizeBattle(b){
  if(!b) return {};
  return {
    id: b.id,
    status: b.status,
    players: b.players,
    currentTeam: b.currentTeam,
    timeLeft: b.timeLeft,
    turn: b.turn,
    logs: b.logs,
    maxTurns: b.maxTurns,
    startedAt: b.startedAt,
    endedAt: b.endedAt
  };
}

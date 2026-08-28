import express from "express";
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const RECONNECT_GRACE_MS = 5 * 60 * 1000;
const EMOJI_COOLDOWN_MS = 400;
const EMOJI_MAX_PER_ROUND = 10;
const ALLOWED_EMOJIS = ["😂","🤣","😭","😡","😎","👏","🔥","💀","❤️","🤡"];

type Suit = "♠" | "♥" | "♦" | "♣";
type Rank = "A"|"2"|"3"|"4"|"5"|"6"|"7"|"8"|"9"|"10"|"J"|"Q"|"K";
type Card = { id:string; suit:Suit; rank:Rank; value:number };
type PlayerStatus = "ACTIVE" | "RECONNECTING" | "LEFT";
type Player = { id:string; name:string; token:string; socketId:string|null; status:PlayerStatus; disconnectedAt:number|null; totalChip:number };
type SettlementLine = { winnerId:string; loserId:string; difference:number; multiplier:number; bonus:number; chips:number };
type RoundResult = { roundNumber:number; starterId:string; reason:"knock"|"initial-trip"; scores:Record<string,number>; roundNet:Record<string,number>; settlements:SettlementLine[] };
type GameState = { roundNumber:number; phase:"playing"|"final-round"|"showdown"; activePlayerIds:string[]; starterId:string; deck:Card[]; discardPile:Card[]; hands:Record<string,Card[]>; currentPlayerId:string|null; hasDrawn:boolean; knockedBy:string|null; finalTurnsRemaining:string[]; initialTripPlayers:string[]; result:RoundResult|null };
type Ledger = Record<string,Record<string,number>>;
type EmojiUsage = Record<string,{count:number;lastAt:number}>;
type Room = { code:string; hostId:string; multiplier:number; status:"waiting"|"playing"|"ended"; players:Player[]; game:GameState|null; ledger:Ledger; history:RoundResult[]; emojiUsage:EmojiUsage };

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer,{ cors:{origin:"*",methods:["GET","POST"]}, connectionStateRecovery:{maxDisconnectionDuration:RECONNECT_GRACE_MS,skipMiddlewares:true}, pingInterval:25000,pingTimeout:20000 });
const rooms = new Map<string,Room>();
const disconnectTimers = new Map<string,ReturnType<typeof setTimeout>>();

const id = () => crypto.randomUUID();
const token = () => crypto.randomBytes(32).toString("hex");
const suits:Suit[]=["♠","♥","♦","♣"];
const ranks:Rank[]=["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
const rankValue=(r:Rank)=>r==="A"?11:["J","Q","K"].includes(r)?10:Number(r);
function createDeck(){ return suits.flatMap(s=>ranks.map(r=>({id:id(),suit:s,rank:r,value:rankValue(r)}))); }
function shuffle<T>(a:T[]){ const x=[...a]; for(let i=x.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[x[i],x[j]]=[x[j],x[i]];} return x; }
function isThreeOfKind(h:Card[]){ return h.length===3 && h.every(c=>c.rank===h[0].rank); }
function calculateScore(h:Card[],initial=false){ if(isThreeOfKind(h)) return initial?31:30.5; const t:Record<Suit,number>={"♠":0,"♥":0,"♦":0,"♣":0}; h.forEach(c=>t[c.suit]+=c.value); return Math.max(...Object.values(t)); }
function createRoomCode(){ const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let c=""; for(let i=0;i<4;i++) c+=chars[Math.floor(Math.random()*chars.length)]; return c; }
function findPlayer(room:Room,pid:string){ return room.players.find(p=>p.id===pid)||null; }
function getSocketPlayer(room:Room,socket:Socket){ return room.players.find(p=>p.socketId===socket.id)||null; }
function activeRoomPlayers(room:Room){ return room.players.filter(p=>p.status!=="LEFT"); }
function activePlayersInRound(room:Room){ if(!room.game)return []; return room.game.activePlayerIds.map(pid=>findPlayer(room,pid)).filter((p):p is Player=>!!p && p.status!=="LEFT"); }
function initLedgerPlayer(room:Room,pid:string){ if(!room.ledger[pid]) room.ledger[pid]={}; for(const p of room.players){ if(!room.ledger[p.id]) room.ledger[p.id]={}; if(room.ledger[pid][p.id]===undefined) room.ledger[pid][p.id]=0; if(room.ledger[p.id][pid]===undefined) room.ledger[p.id][pid]=0; } }
function updateLedger(room:Room,w:string,l:string,chips:number){ initLedgerPlayer(room,w);initLedgerPlayer(room,l);room.ledger[w][l]+=chips;room.ledger[l][w]-=chips; }
function chooseNewHost(room:Room){ const next=room.players.find(p=>p.status!=="LEFT"); if(next) room.hostId=next.id; }

function determineNextStarter(room:Room){
  const live=activeRoomPlayers(room);
  if(!live.length) return room.hostId;
  if(room.history.length===0) return live.some(p=>p.id===room.hostId)?room.hostId:live[0].id;
  const prev=room.history[room.history.length-1];
  const candidates=live.filter(p=>prev.scores[p.id]!==undefined);
  if(!candidates.length) return live[0].id;
  const max=Math.max(...candidates.map(p=>prev.scores[p.id]));
  let tied=candidates.filter(p=>prev.scores[p.id]===max);
  if(tied.length===1)return tied[0].id;
  const scored=tied.map(p=>({p,v:tied.reduce((s,o)=>o.id===p.id?s:s+(room.ledger[p.id]?.[o.id]||0),0)}));
  const best=Math.max(...scored.map(x=>x.v)); tied=scored.filter(x=>x.v===best).map(x=>x.p);
  if(tied.length===1)return tied[0].id;
  return live.find(p=>tied.some(t=>t.id===p.id))?.id || live[0].id;
}

function publicRoom(room:Room){ return { code:room.code,hostId:room.hostId,multiplier:room.multiplier,status:room.status,reconnectGraceMs:RECONNECT_GRACE_MS,players:room.players.map(p=>({id:p.id,name:p.name,totalChip:p.totalChip,status:p.status,disconnectedAt:p.disconnectedAt})),ledger:room.ledger,history:room.history }; }

function sendGameState(room:Room){
  io.to(room.code).emit("room-update",publicRoom(room));
  if(!room.game)return;
  const g=room.game; const top=g.discardPile[g.discardPile.length-1]||null;
  for(const p of room.players){ if(!p.socketId||p.status==="LEFT")continue; const s=io.sockets.sockets.get(p.socketId); if(!s)continue; s.emit("game-state",{ myPlayerId:p.id,roundNumber:g.roundNumber,phase:g.phase,hand:g.hands[p.id]||[],activeInRound:g.activePlayerIds.includes(p.id),tablePlayers:room.players.filter(o=>o.id!==p.id).map(o=>({id:o.id,name:o.name,totalChip:o.totalChip,status:o.status,activeInRound:g.activePlayerIds.includes(o.id),cardCount:g.hands[o.id]?.length||0})),starterId:g.starterId,currentPlayerId:g.currentPlayerId,hasDrawn:g.hasDrawn,knockedBy:g.knockedBy,finalTurnsRemaining:g.finalTurnsRemaining,deckCount:g.deck.length,topDiscard:top,result:g.result,emojiRemaining:Math.max(0,EMOJI_MAX_PER_ROUND-(room.emojiUsage[p.id]?.count||0)) }); }
}

function settleRound(room:Room,reason:RoundResult["reason"]){
  const g=room.game;if(!g)return; const ps=activePlayersInRound(room); const scores:Record<string,number>={}; const roundNet:Record<string,number>={}; const settlements:SettlementLine[]=[];
  for(const p of ps){const h=g.hands[p.id]||[];scores[p.id]=g.initialTripPlayers.includes(p.id)?31:calculateScore(h);roundNet[p.id]=0;}
  for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++){const a=ps[i],b=ps[j],sa=scores[a.id],sb=scores[b.id];if(sa===sb)continue;const w=sa>sb?a:b,l=sa>sb?b:a,ws=scores[w.id],ls=scores[l.id],diff=ws-ls,bonus=ws===31?2:1,chips=diff*room.multiplier*bonus;roundNet[w.id]+=chips;roundNet[l.id]-=chips;w.totalChip+=chips;l.totalChip-=chips;updateLedger(room,w.id,l.id,chips);settlements.push({winnerId:w.id,loserId:l.id,difference:diff,multiplier:room.multiplier,bonus,chips});}
  const result={roundNumber:g.roundNumber,starterId:g.starterId,reason,scores,roundNet,settlements};room.history.push(result);g.phase="showdown";g.currentPlayerId=null;g.hasDrawn=false;g.result=result;sendGameState(room);
}

function startRound(room:Room,opts:{roundNumber?:number;starterId?:string}={}){
  const live=activeRoomPlayers(room); if(live.length<2){room.status="waiting";room.game=null;sendGameState(room);return;}
  let deck=shuffle(createDeck()); const ids=live.map(p=>p.id); let starter=opts.starterId&&ids.includes(opts.starterId)?opts.starterId:room.history.length===0?(ids.includes(room.hostId)?room.hostId:ids[0]):determineNextStarter(room); if(!ids.includes(starter))starter=ids[0]; const si=ids.indexOf(starter);const ordered=[...ids.slice(si),...ids.slice(0,si)];const hands:Record<string,Card[]>={};ordered.forEach(x=>hands[x]=[]);for(let r=0;r<3;r++)for(const pid of ordered){const c=deck.pop();if(c)hands[pid].push(c);}const trips=ordered.filter(pid=>isThreeOfKind(hands[pid])); const rn=opts.roundNumber??((room.game?.roundNumber||0)+1); room.status="playing";room.emojiUsage={};live.forEach(p=>room.emojiUsage[p.id]={count:0,lastAt:0});room.game={roundNumber:rn,phase:"playing",activePlayerIds:ordered,starterId:starter,deck,discardPile:[],hands,currentPlayerId:starter,hasDrawn:false,knockedBy:null,finalTurnsRemaining:[],initialTripPlayers:trips,result:null}; if(trips.length){settleRound(room,"initial-trip");return;} const first=room.game.deck.pop();if(first)room.game.discardPile.push(first);sendGameState(room);
}
function restartVoidRound(room:Room,round:number,starter:string){startRound(room,{roundNumber:round,starterId:activeRoomPlayers(room).some(p=>p.id===starter)?starter:room.hostId});}
function advanceTurn(room:Room){const g=room.game;if(!g||!g.currentPlayerId)return;const ids=g.activePlayerIds;const i=ids.indexOf(g.currentPlayerId);g.currentPlayerId=ids[(i+1)%ids.length];g.hasDrawn=false;}
function advanceFinalTurn(room:Room){const g=room.game;if(!g)return;if(g.finalTurnsRemaining.length)g.finalTurnsRemaining.shift();if(!g.finalTurnsRemaining.length){settleRound(room,"knock");return;}g.currentPlayerId=g.finalTurnsRemaining[0];g.hasDrawn=false;sendGameState(room);}
function rebuildDeck(g:GameState){if(g.deck.length||g.discardPile.length<=1)return;const top=g.discardPile.pop()!;g.deck=shuffle(g.discardPile);g.discardPile=[top];}

function markPlayerLeft(room:Room,player:Player){
  const g=room.game; const wasActive=!!g&&g.phase!=="showdown"&&g.activePlayerIds.includes(player.id); const round=g?.roundNumber||0,starter=g?.starterId||room.hostId;
  player.status="LEFT";player.socketId=null;player.disconnectedAt=Date.now(); const timer=disconnectTimers.get(player.id);if(timer){clearTimeout(timer);disconnectTimers.delete(player.id);} if(room.hostId===player.id)chooseNewHost(room);
  if(wasActive&&room.status==="playing"){restartVoidRound(room,round,starter);return;}
  if(g){delete g.hands[player.id];g.activePlayerIds=g.activePlayerIds.filter(x=>x!==player.id);g.finalTurnsRemaining=g.finalTurnsRemaining.filter(x=>x!==player.id);}
  sendGameState(room);
}

io.on("connection",socket=>{
  socket.on("create-room",(data:{name:string;multiplier:number},cb)=>{let code=createRoomCode();while(rooms.has(code))code=createRoomCode();const p:Player={id:id(),name:data.name?.trim()||"Player",token:token(),socketId:socket.id,status:"ACTIVE",disconnectedAt:null,totalChip:0};const room:Room={code,hostId:p.id,multiplier:Number(data.multiplier)||1,status:"waiting",players:[p],game:null,ledger:{},history:[],emojiUsage:{}};rooms.set(code,room);initLedgerPlayer(room,p.id);socket.join(code);cb({ok:true,playerId:p.id,playerToken:p.token,room:publicRoom(room)});sendGameState(room);});
  socket.on("join-room",(data:{name:string;code:string},cb)=>{const room=rooms.get(data.code?.trim().toUpperCase());if(!room)return cb({ok:false,message:"ไม่พบห้อง"});if(room.status==="ended")return cb({ok:false,message:"เกมจบแล้ว"});const p:Player={id:id(),name:data.name?.trim()||"Player",token:token(),socketId:socket.id,status:"ACTIVE",disconnectedAt:null,totalChip:0};room.players.push(p);initLedgerPlayer(room,p.id);room.emojiUsage[p.id]={count:0,lastAt:0};socket.join(room.code);cb({ok:true,playerId:p.id,playerToken:p.token,room:publicRoom(room)});sendGameState(room);});
  socket.on("resume-session",(data:{code:string;playerId:string;playerToken:string},cb)=>{const room=rooms.get(data.code?.trim().toUpperCase());if(!room)return cb({ok:false,message:"ห้องนี้ไม่มีอยู่แล้ว"});const p=findPlayer(room,data.playerId);if(!p||p.token!==data.playerToken)return cb({ok:false,message:"Session ไม่ถูกต้อง"});if(p.status==="LEFT")return cb({ok:false,message:"คุณออกจากห้องนี้แล้ว"});const t=disconnectTimers.get(p.id);if(t){clearTimeout(t);disconnectTimers.delete(p.id);}p.socketId=socket.id;p.status="ACTIVE";p.disconnectedAt=null;socket.join(room.code);cb({ok:true,playerId:p.id,room:publicRoom(room)});sendGameState(room);});
  socket.on("start-game",(d:{code:string},cb)=>{const room=rooms.get(d.code.toUpperCase());if(!room)return cb({ok:false});const p=getSocketPlayer(room,socket);if(!p||p.id!==room.hostId)return cb({ok:false,message:"เฉพาะ Host"});if(activeRoomPlayers(room).length<2)return cb({ok:false,message:"ต้องมีอย่างน้อย 2 คน"});startRound(room);cb({ok:true});});
  socket.on("draw-deck",(d:{code:string},cb)=>{const room=rooms.get(d.code),g=room?.game;if(!room||!g)return cb({ok:false});const p=getSocketPlayer(room,socket);if(!p||p.status!=="ACTIVE")return cb({ok:false,message:"Session ไม่ถูกต้อง"});if(g.currentPlayerId!==p.id)return cb({ok:false,message:"ยังไม่ถึงตาคุณ"});if(g.hasDrawn)return cb({ok:false,message:"คุณจั่วแล้ว"});rebuildDeck(g);const c=g.deck.pop();if(!c)return cb({ok:false,message:"ไม่มีไพ่"});g.hands[p.id].push(c);g.hasDrawn=true;sendGameState(room);cb({ok:true});});
  socket.on("draw-discard",(d:{code:string},cb)=>{const room=rooms.get(d.code),g=room?.game;if(!room||!g)return cb({ok:false});const p=getSocketPlayer(room,socket);if(!p||g.currentPlayerId!==p.id||g.hasDrawn)return cb({ok:false,message:"ทำรายการไม่ได้"});const c=g.discardPile.pop();if(!c)return cb({ok:false,message:"ไม่มีกองทิ้ง"});g.hands[p.id].push(c);g.hasDrawn=true;sendGameState(room);cb({ok:true});});
  socket.on("discard-card",(d:{code:string;cardId:string},cb)=>{const room=rooms.get(d.code),g=room?.game;if(!room||!g)return cb({ok:false});const p=getSocketPlayer(room,socket);if(!p||g.currentPlayerId!==p.id||!g.hasDrawn)return cb({ok:false,message:"ทำรายการไม่ได้"});const h=g.hands[p.id],i=h.findIndex(c=>c.id===d.cardId);if(i<0)return cb({ok:false});const [c]=h.splice(i,1);g.discardPile.push(c);g.hasDrawn=false;if(g.phase==="final-round"){advanceFinalTurn(room);cb({ok:true});return;}advanceTurn(room);sendGameState(room);cb({ok:true});});
  socket.on("knock",(d:{code:string},cb)=>{const room=rooms.get(d.code),g=room?.game;if(!room||!g)return cb({ok:false});const p=getSocketPlayer(room,socket);if(!p||g.phase!=="playing"||g.currentPlayerId!==p.id||g.hasDrawn)return cb({ok:false,message:"Knock ไม่ได้"});const ids=g.activePlayerIds,i=ids.indexOf(p.id),finals:string[]=[];for(let s=1;s<ids.length;s++)finals.push(ids[(i+s)%ids.length]);g.phase="final-round";g.knockedBy=p.id;g.finalTurnsRemaining=finals;g.currentPlayerId=finals[0]||null;g.hasDrawn=false;sendGameState(room);cb({ok:true});});
  socket.on("next-round",(d:{code:string},cb)=>{const room=rooms.get(d.code);if(!room)return cb({ok:false});const p=getSocketPlayer(room,socket);if(!p||p.id!==room.hostId)return cb({ok:false,message:"เฉพาะ Host"});if(room.game?.phase!=="showdown")return cb({ok:false,message:"รอบยังไม่จบ"});startRound(room);cb({ok:true});});
  socket.on("emoji-reaction",(d:{code:string;emoji:string},cb)=>{const room=rooms.get(d.code);if(!room||!ALLOWED_EMOJIS.includes(d.emoji))return cb?.({ok:false});const p=getSocketPlayer(room,socket);if(!p)return cb?.({ok:false});const u=room.emojiUsage[p.id]||(room.emojiUsage[p.id]={count:0,lastAt:0});const now=Date.now();if(u.count>=EMOJI_MAX_PER_ROUND)return cb?.({ok:false,message:"Emoji ครบ 10 ครั้งแล้ว",remaining:0});if(now-u.lastAt<EMOJI_COOLDOWN_MS)return cb?.({ok:false,message:"กดเร็วเกินไป",remaining:EMOJI_MAX_PER_ROUND-u.count});u.count++;u.lastAt=now;const remaining=EMOJI_MAX_PER_ROUND-u.count;io.to(room.code).emit("emoji-reaction",{id:`${p.id}-${now}-${Math.random()}`,playerId:p.id,name:p.name,emoji:d.emoji,seed:Math.random(),remaining});cb?.({ok:true,remaining});});
  socket.on("leave-room",(d:{code:string},cb)=>{const room=rooms.get(d.code);if(!room)return cb({ok:false});const p=getSocketPlayer(room,socket);if(!p)return cb({ok:false});markPlayerLeft(room,p);socket.leave(room.code);cb({ok:true});});
  socket.on("end-game",(d:{code:string},cb)=>{const room=rooms.get(d.code);if(!room)return cb({ok:false});const p=getSocketPlayer(room,socket);if(!p||p.id!==room.hostId)return cb({ok:false,message:"เฉพาะ Host"});room.status="ended";if(room.game)room.game.currentPlayerId=null;sendGameState(room);cb({ok:true});});
  socket.on("disconnect",()=>{for(const room of rooms.values()){const p=room.players.find(x=>x.socketId===socket.id);if(!p)continue;if(p.status==="LEFT")continue;p.socketId=null;p.status="RECONNECTING";p.disconnectedAt=Date.now();sendGameState(room);const old=disconnectTimers.get(p.id);if(old)clearTimeout(old);disconnectTimers.set(p.id,setTimeout(()=>{const r=rooms.get(room.code);const current=r&&findPlayer(r,p.id);if(current&&current.status==="RECONNECTING")markPlayerLeft(r!,current);},RECONNECT_GRACE_MS));break;}});
});

app.get("/health",(_,res)=>res.json({ok:true,game:"31 Scat V4",reconnectGraceSeconds:RECONNECT_GRACE_MS/1000,rooms:rooms.size}));
const __filename=fileURLToPath(import.meta.url);const __dirname=path.dirname(__filename);const distPath=path.join(__dirname,"../dist");app.use(express.static(distPath));app.get("*",(_,res)=>res.sendFile(path.join(distPath,"index.html")));
const PORT=Number(process.env.PORT)||3001;httpServer.listen(PORT,"0.0.0.0",()=>console.log(`🃏 31 Scat V4 on ${PORT}`));

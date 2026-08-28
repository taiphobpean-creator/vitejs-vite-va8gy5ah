import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

type Player = {
  id: string;
  name: string;
  totalChip: number;
};

type Room = {
  code: string;
  hostId: string;
  multiplier: number;
  players: Player[];
};

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const rooms = new Map<string, Room>();

function createRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  let result = '';

  for (let i = 0; i < 4; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }

  return result;
}

io.on('connection', (socket) => {
  console.log('🟢 Connected:', socket.id);

  socket.on(
    'create-room',
    (
      data: {
        name: string;
        multiplier: number;
      },
      callback
    ) => {
      let code = createRoomCode();

      while (rooms.has(code)) {
        code = createRoomCode();
      }

      const room: Room = {
        code,
        hostId: socket.id,
        multiplier: Number(data.multiplier) || 1,
        players: [
          {
            id: socket.id,
            name: data.name || 'Player',
            totalChip: 0,
          },
        ],
      };

      rooms.set(code, room);

      socket.join(code);

      callback({
        ok: true,
        room,
      });

      io.to(code).emit('room-update', room);
    }
  );

  socket.on(
    'join-room',
    (
      data: {
        name: string;
        code: string;
      },
      callback
    ) => {
      const code = data.code.toUpperCase();
      const room = rooms.get(code);

      if (!room) {
        callback({
          ok: false,
          message: 'ไม่พบห้อง',
        });

        return;
      }

      if (room.players.length >= 8) {
        callback({
          ok: false,
          message: 'ห้องเต็มแล้ว',
        });

        return;
      }

      room.players.push({
        id: socket.id,
        name: data.name || 'Player',
        totalChip: 0,
      });

      socket.join(code);

      callback({
        ok: true,
        room,
      });

      io.to(code).emit('room-update', room);
    }
  );

  socket.on('disconnect', () => {
    console.log('🔴 Disconnected:', socket.id);

    for (const [code, room] of rooms) {
      const index = room.players.findIndex((player) => player.id === socket.id);

      if (index === -1) continue;

      room.players.splice(index, 1);

      if (room.players.length === 0) {
        rooms.delete(code);
        continue;
      }

      if (room.hostId === socket.id) {
        room.hostId = room.players[0].id;
      }

      io.to(code).emit('room-update', room);
    }
  });
});

app.get('/health', (_, res) => {
  res.json({
    ok: true,
    game: '31 Scat',
  });
});

const PORT = 3001;

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('🃏 31 Scat Server');
  console.log(`🚀 http://localhost:${PORT}`);
  console.log('');
});

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from "path";
import { fileURLToPath } from "url";

type Player = {
  id: string;
  name: string;
  totalChip: number;
};

const room: Room = {
  code,
  hostId: socket.id,
  multiplier: Number(data.multiplier) || 1,
  status: "waiting",
  players: [
    {
      id: socket.id,
      name: data.name || "Player",
      totalChip: 0
    }
  ]
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
socket.on(
  "start-game",
  (
    data: { code: string },
    callback
  ) => {
    const room = rooms.get(
      data.code.toUpperCase()
    );

    if (!room) {
      callback({
        ok: false,
        message: "ไม่พบห้อง"
      });

      return;
    }

    if (room.hostId !== socket.id) {
      callback({
        ok: false,
        message: "เฉพาะ Host เท่านั้นที่เริ่มเกมได้"
      });

      return;
    }

    if (room.players.length < 2) {
      callback({
        ok: false,
        message: "ต้องมีอย่างน้อย 2 คน"
      });

      return;
    }

    room.status = "playing";

    io.to(room.code).emit(
      "room-update",
      room
    );

    io.to(room.code).emit(
      "game-started",
      {
        message: "เกมเริ่มแล้ว"
      }
    );

    callback({
      ok: true
    });
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
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distPath = path.join(__dirname, "../dist");

app.use(express.static(distPath));

app.get("*", (_, res) => {
  res.sendFile(
    path.join(distPath, "index.html")
  );
});
const PORT = Number(process.env.PORT) || 3001;

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('🃏 31 Scat Server');
  console.log(`🚀 http://localhost:${PORT}`);
  console.log('');
});

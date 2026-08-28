import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

type Player = {
  id: string;
  name: string;
  totalChip: number;
};

type RoomStatus = "waiting" | "playing";

type Room = {
  code: string;
  hostId: string;
  multiplier: number;
  status: RoomStatus;
  players: Player[];
};

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const rooms = new Map<string, Room>();

// ==========================================
// CREATE ROOM CODE
// ==========================================

function createRoomCode() {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let result = "";

  for (let i = 0; i < 4; i++) {
    result +=
      chars[
        Math.floor(
          Math.random() * chars.length
        )
      ];
  }

  return result;
}

// ==========================================
// SOCKET
// ==========================================

io.on("connection", (socket) => {
  console.log(
    "🟢 Connected:",
    socket.id
  );

  // ========================================
  // CREATE ROOM
  // ========================================

  socket.on(
    "create-room",
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

      const playerName =
        data.name?.trim() || "Player";

      const multiplier =
        Number(data.multiplier) || 1;

      const room: Room = {
        code,
        hostId: socket.id,

        multiplier,

        status: "waiting",

        players: [
          {
            id: socket.id,
            name: playerName,
            totalChip: 0,
          },
        ],
      };

      rooms.set(code, room);

      socket.join(code);

      console.log(
        `🏠 Room created: ${code}`
      );

      callback({
        ok: true,
        room,
      });

      io.to(code).emit(
        "room-update",
        room
      );
    }
  );

  // ========================================
  // JOIN ROOM
  // ========================================

  socket.on(
    "join-room",
    (
      data: {
        name: string;
        code: string;
      },
      callback
    ) => {
      const code =
        data.code
          ?.trim()
          .toUpperCase() || "";

      const room =
        rooms.get(code);

      if (!room) {
        callback({
          ok: false,
          message: "ไม่พบห้อง",
        });

        return;
      }

      if (
        room.status !== "waiting"
      ) {
        callback({
          ok: false,
          message:
            "เกมเริ่มไปแล้ว ไม่สามารถเข้าห้องได้",
        });

        return;
      }

      if (
        room.players.length >= 8
      ) {
        callback({
          ok: false,
          message: "ห้องเต็มแล้ว",
        });

        return;
      }

      // ป้องกัน socket เดิมเข้าซ้ำ
      const alreadyJoined =
        room.players.some(
          (player) =>
            player.id === socket.id
        );

      if (!alreadyJoined) {
        room.players.push({
          id: socket.id,
          name:
            data.name?.trim() ||
            "Player",
          totalChip: 0,
        });
      }

      socket.join(code);

      console.log(
        `👤 ${data.name} joined ${code}`
      );

      callback({
        ok: true,
        room,
      });

      io.to(code).emit(
        "room-update",
        room
      );
    }
  );

  // ========================================
  // START GAME
  // ========================================

  socket.on(
    "start-game",
    (
      data: {
        code: string;
      },
      callback
    ) => {
      const code =
        data.code
          ?.trim()
          .toUpperCase() || "";

      const room =
        rooms.get(code);

      if (!room) {
        callback({
          ok: false,
          message: "ไม่พบห้อง",
        });

        return;
      }

      // เฉพาะ Host
      if (
        room.hostId !== socket.id
      ) {
        callback({
          ok: false,
          message:
            "เฉพาะ Host เท่านั้นที่เริ่มเกมได้",
        });

        return;
      }

      // ต้องมีอย่างน้อย 2 คน
      if (
        room.players.length < 2
      ) {
        callback({
          ok: false,
          message:
            "ต้องมีผู้เล่นอย่างน้อย 2 คน",
        });

        return;
      }

      if (
        room.status === "playing"
      ) {
        callback({
          ok: false,
          message:
            "เกมเริ่มไปแล้ว",
        });

        return;
      }

      room.status = "playing";

      console.log(
        `🎮 Game started: ${code}`
      );

      // ส่ง state ใหม่ให้ทุกคน
      io.to(code).emit(
        "room-update",
        room
      );

      // Event สำหรับอนาคต
      io.to(code).emit(
        "game-started",
        {
          roomCode: code,
          message: "เกมเริ่มแล้ว",
        }
      );

      callback({
        ok: true,
      });
    }
  );

  // ========================================
  // DISCONNECT
  // ========================================

  socket.on(
    "disconnect",
    () => {
      console.log(
        "🔴 Disconnected:",
        socket.id
      );

      for (
        const [code, room]
        of rooms
      ) {
        const index =
          room.players.findIndex(
            (player) =>
              player.id ===
              socket.id
          );

        if (index === -1) {
          continue;
        }

        room.players.splice(
          index,
          1
        );

        // ไม่มีผู้เล่นเหลือ
        if (
          room.players.length === 0
        ) {
          rooms.delete(code);

          console.log(
            `🗑️ Room deleted: ${code}`
          );

          continue;
        }

        // Host หลุด
        if (
          room.hostId === socket.id
        ) {
          room.hostId =
            room.players[0].id;

          console.log(
            `👑 New host: ${room.players[0].name}`
          );
        }

        io.to(code).emit(
          "room-update",
          room
        );
      }
    }
  );
});

// ==========================================
// HEALTH CHECK
// ==========================================

app.get(
  "/health",
  (_, res) => {
    res.json({
      ok: true,
      game: "31 Scat",
      rooms: rooms.size,
    });
  }
);

// ==========================================
// SERVE REACT BUILD
// ==========================================

const __filename =
  fileURLToPath(
    import.meta.url
  );

const __dirname =
  path.dirname(__filename);

const distPath =
  path.join(
    __dirname,
    "../dist"
  );

app.use(
  express.static(distPath)
);

app.get("*", (_, res) => {
  res.sendFile(
    path.join(
      distPath,
      "index.html"
    )
  );
});

// ==========================================
// START SERVER
// ==========================================

const PORT =
  Number(process.env.PORT) ||
  3001;

httpServer.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log("");
    console.log(
      "🃏 31 Scat Server"
    );
    console.log(
      `🚀 http://localhost:${PORT}`
    );
    console.log("");
  }
);

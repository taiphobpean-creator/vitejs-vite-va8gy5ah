import express from "express";
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

// ======================================================
// CONFIG
// ======================================================

const RECONNECT_GRACE_MS = 5 * 60 * 1000;

const EMOJI_COOLDOWN_MS = 400;
const EMOJI_MAX_PER_ROUND = 10;

const ALLOWED_EMOJIS = [
  "😂",
  "🤣",
  "😭",
  "😡",
  "😎",
  "👏",
  "🔥",
  "💀",
  "❤️",
  "🤡",
];

// ======================================================
// TYPES
// ======================================================

type Suit = "♠" | "♥" | "♦" | "♣";

type Rank =
  | "A"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "J"
  | "Q"
  | "K";

type PlayerStatus =
  | "ACTIVE"
  | "RECONNECTING"
  | "LEFT";

type Card = {
  id: string;
  suit: Suit;
  rank: Rank;
  value: number;
};

type Player = {
  id: string;
  name: string;

  token: string;

  socketId: string | null;

  status: PlayerStatus;

  disconnectedAt: number | null;

  totalChip: number;
};

type SettlementLine = {
  winnerId: string;
  loserId: string;

  difference: number;

  multiplier: number;

  bonus: number;

  chips: number;
};

type RoundResult = {
  roundNumber: number;

  starterId: string;

  reason:
    | "knock"
    | "initial-trip";

  scores: Record<string, number>;

  roundNet: Record<string, number>;

  settlements: SettlementLine[];
};

type GameState = {
  roundNumber: number;

  phase:
    | "playing"
    | "final-round"
    | "showdown";

  activePlayerIds: string[];

  starterId: string;

  deck: Card[];

  discardPile: Card[];

  hands: Record<
    string,
    Card[]
  >;

  currentPlayerId:
    string | null;

  hasDrawn: boolean;

  knockedBy:
    string | null;

  finalTurnsRemaining:
    string[];

  initialTripPlayers:
    string[];

  result:
    RoundResult | null;
};

type Ledger = Record<
  string,
  Record<string, number>
>;

type EmojiUsage = Record<
  string,
  {
    count: number;
    lastAt: number;
  }
>;

type Room = {
  code: string;

  hostId: string;

  multiplier: number;

  status:
    | "waiting"
    | "playing"
    | "ended";

  players: Player[];

  game: GameState | null;

  ledger: Ledger;

  history: RoundResult[];

  emojiUsage: EmojiUsage;
};

// ======================================================
// APP
// ======================================================

const app = express();

const httpServer =
  createServer(app);

const io =
  new Server(httpServer, {
    cors: {
      origin: "*",
      methods: [
        "GET",
        "POST",
      ],
    },

    connectionStateRecovery: {
      maxDisconnectionDuration:
        RECONNECT_GRACE_MS,

      skipMiddlewares: true,
    },

    pingInterval: 25000,

    pingTimeout: 20000,
  });

const rooms =
  new Map<string, Room>();

const disconnectTimers =
  new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

// ======================================================
// ID
// ======================================================

function createId() {
  return crypto.randomUUID();
}

function createToken() {
  return crypto
    .randomBytes(32)
    .toString("hex");
}

// ======================================================
// DECK
// ======================================================

const suits: Suit[] = [
  "♠",
  "♥",
  "♦",
  "♣",
];

const ranks: Rank[] = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
];

function rankValue(
  rank: Rank
) {
  if (rank === "A") {
    return 11;
  }

  if (
    rank === "J" ||
    rank === "Q" ||
    rank === "K"
  ) {
    return 10;
  }

  return Number(rank);
}

function createDeck(): Card[] {
  const deck: Card[] = [];

  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({
        id: createId(),

        suit,

        rank,

        value:
          rankValue(rank),
      });
    }
  }

  return deck;
}

function shuffle<T>(
  items: T[]
) {
  const copy =
    [...items];

  for (
    let i =
      copy.length - 1;
    i > 0;
    i--
  ) {
    const j =
      Math.floor(
        Math.random() *
          (i + 1)
      );

    [
      copy[i],
      copy[j],
    ] = [
      copy[j],
      copy[i],
    ];
  }

  return copy;
}

// ======================================================
// SCORE
// ======================================================

function isThreeOfKind(
  hand: Card[]
) {
  if (
    hand.length !== 3
  ) {
    return false;
  }

  return hand.every(
    (card) =>
      card.rank ===
      hand[0].rank
  );
}

function calculateScore(
  hand: Card[],
  initial = false
) {
  if (
    isThreeOfKind(hand)
  ) {
    return initial
      ? 31
      : 30.5;
  }

  const totals: Record<
    Suit,
    number
  > = {
    "♠": 0,
    "♥": 0,
    "♦": 0,
    "♣": 0,
  };

  for (
    const card
    of hand
  ) {
    totals[
      card.suit
    ] += card.value;
  }

  return Math.max(
    ...Object.values(
      totals
    )
  );
}

// ======================================================
// ROOM CODE
// ======================================================

function createRoomCode() {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let result = "";

  for (
    let i = 0;
    i < 4;
    i++
  ) {
    result +=
      chars[
        Math.floor(
          Math.random() *
            chars.length
        )
      ];
  }

  return result;
}

// ======================================================
// PLAYER HELPERS
// ======================================================

function findPlayer(
  room: Room,
  id: string
) {
  return (
    room.players.find(
      (player) =>
        player.id === id
    ) || null
  );
}

function getSocketPlayer(
  room: Room,
  socket: Socket
) {
  return (
    room.players.find(
      (player) =>
        player.socketId ===
        socket.id
    ) || null
  );
}

function findBySocket(
  socketId: string
) {
  for (
    const room
    of rooms.values()
  ) {
    const player =
      room.players.find(
        (item) =>
          item.socketId ===
          socketId
      );

    if (player) {
      return {
        room,
        player,
      };
    }
  }

  return null;
}

function livePlayers(
  room: Room
) {
  return room.players.filter(
    (player) =>
      player.status !==
      "LEFT"
  );
}

function activePlayers(
  room: Room
) {
  if (!room.game) {
    return [];
  }

  return room.game
    .activePlayerIds
    .map(
      (id) =>
        findPlayer(
          room,
          id
        )
    )
    .filter(
      (
        player
      ): player is Player =>
        player !== null
    );
}

// ======================================================
// LEDGER
// ======================================================

function ensureLedger(
  room: Room,
  playerId: string
) {
  if (
    !room.ledger[
      playerId
    ]
  ) {
    room.ledger[
      playerId
    ] = {};
  }

  for (
    const player
    of room.players
  ) {
    if (
      !room.ledger[
        player.id
      ]
    ) {
      room.ledger[
        player.id
      ] = {};
    }

    if (
      room.ledger[
        playerId
      ][player.id] ===
      undefined
    ) {
      room.ledger[
        playerId
      ][player.id] = 0;
    }

    if (
      room.ledger[
        player.id
      ][playerId] ===
      undefined
    ) {
      room.ledger[
        player.id
      ][playerId] = 0;
    }
  }
}

// ======================================================
// PUBLIC ROOM
// ======================================================

function publicRoom(
  room: Room
) {
  return {
    code:
      room.code,

    hostId:
      room.hostId,

    multiplier:
      room.multiplier,

    status:
      room.status,

    reconnectGraceMs:
      RECONNECT_GRACE_MS,

    players:
      room.players.map(
        (player) => ({
          id:
            player.id,

          name:
            player.name,

          totalChip:
            player.totalChip,

          status:
            player.status,

          disconnectedAt:
            player.disconnectedAt,
        })
      ),

    ledger:
      room.ledger,

    history:
      room.history,
  };
}

// ======================================================
// SEND STATE
// ======================================================

function sendState(
  room: Room
) {
  io.to(
    room.code
  ).emit(
    "room-update",
    publicRoom(room)
  );

  if (!room.game) {
    return;
  }

  const game =
    room.game;

  const topDiscard =
    game.discardPile[
      game.discardPile
        .length - 1
    ] || null;

  for (
    const player
    of room.players
  ) {
    if (
      !player.socketId ||
      player.status ===
        "LEFT"
    ) {
      continue;
    }

    const playerSocket =
      io.sockets.sockets.get(
        player.socketId
      );

    if (!playerSocket) {
      continue;
    }

    playerSocket.emit(
      "game-state",
      {
        myPlayerId:
          player.id,

        roundNumber:
          game.roundNumber,

        phase:
          game.phase,

        hand:
          game.hands[
            player.id
          ] || [],

        activeInRound:
          game.activePlayerIds.includes(
            player.id
          ),

        tablePlayers:
          room.players
            .filter(
              (other) =>
                other.id !==
                player.id
            )
            .map(
              (other) => ({
                id:
                  other.id,

                name:
                  other.name,

                totalChip:
                  other.totalChip,

                status:
                  other.status,

                activeInRound:
                  game.activePlayerIds.includes(
                    other.id
                  ),

                cardCount:
                  game.hands[
                    other.id
                  ]?.length ||
                  0,
              })
            ),

        starterId:
          game.starterId,

        currentPlayerId:
          game.currentPlayerId,

        hasDrawn:
          game.hasDrawn,

        knockedBy:
          game.knockedBy,

        finalTurnsRemaining:
          game.finalTurnsRemaining,

        deckCount:
          game.deck.length,

        topDiscard,

        result:
          game.result,

        emojiRemaining:
          Math.max(
            0,

            EMOJI_MAX_PER_ROUND -
              (
                room
                  .emojiUsage[
                  player.id
                ]?.count ||
                0
              )
          ),
      }
    );
  }
}

// ======================================================
// IMPORTANT:
// ใส่ Game Engine เดิมของคุณตรงกลางนี้
//
// settleRound()
// startRound()
// advanceTurn()
// advanceFinalTurn()
// rebuildDeck()
// leavePlayer()
// expireReconnect()
//
// ใช้โค้ดล่าสุดที่เราทำไว้ได้เลย
// ======================================================

// ======================================================
// CREATE / JOIN
// ======================================================

io.on(
  "connection",
  (socket) => {
    console.log(
      "🟢 Connected:",
      socket.id
    );

    socket.on(
      "create-room",
      (
        data: {
          name: string;
          multiplier: number;
        },
        callback
      ) => {
        let code =
          createRoomCode();

        while (
          rooms.has(code)
        ) {
          code =
            createRoomCode();
        }

        const player:
          Player = {
          id:
            createId(),

          name:
            data.name?.trim() ||
            "Player",

          token:
            createToken(),

          socketId:
            socket.id,

          status:
            "ACTIVE",

          disconnectedAt:
            null,

          totalChip:
            0,
        };

        const room:
          Room = {
          code,

          hostId:
            player.id,

          multiplier:
            Number(
              data.multiplier
            ) || 1,

          status:
            "waiting",

          players:
            [player],

          game:
            null,

          ledger:
            {},

          history:
            [],

          emojiUsage:
            {},
        };

        rooms.set(
          code,
          room
        );

        ensureLedger(
          room,
          player.id
        );

        socket.join(
          code
        );

        callback({
          ok: true,

          playerId:
            player.id,

          playerToken:
            player.token,

          room:
            publicRoom(
              room
            ),
        });

        sendState(
          room
        );
      }
    );

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
            .trim()
            .toUpperCase();

        const room =
          rooms.get(code);

        if (!room) {
          callback({
            ok: false,
            message:
              "ไม่พบห้อง",
          });

          return;
        }

        if (
          room.status ===
          "ended"
        ) {
          callback({
            ok: false,
            message:
              "เกมจบแล้ว",
          });

          return;
        }

        const player:
          Player = {
          id:
            createId(),

          name:
            data.name?.trim() ||
            "Player",

          token:
            createToken(),

          socketId:
            socket.id,

          status:
            "ACTIVE",

          disconnectedAt:
            null,

          totalChip:
            0,
        };

        room.players.push(
          player
        );

        ensureLedger(
          room,
          player.id
        );

        room.emojiUsage[
          player.id
        ] = {
          count: 0,
          lastAt: 0,
        };

        socket.join(
          room.code
        );

        callback({
          ok: true,

          playerId:
            player.id,

          playerToken:
            player.token,

          room:
            publicRoom(
              room
            ),
        });

        sendState(
          room
        );
      }
    );

    // ==================================================
    // RESUME
    // ==================================================

    socket.on(
      "resume-session",
      (
        data: {
          code: string;
          playerId: string;
          playerToken: string;
        },
        callback
      ) => {
        const room =
          rooms.get(
            data.code
              .trim()
              .toUpperCase()
          );

        if (!room) {
          callback({
            ok: false,
            message:
              "ห้องนี้ไม่มีอยู่แล้ว",
          });

          return;
        }

        const player =
          findPlayer(
            room,
            data.playerId
          );

        if (
          !player ||
          player.token !==
            data.playerToken
        ) {
          callback({
            ok: false,
            message:
              "Session ไม่ถูกต้อง",
          });

          return;
        }

        if (
          player.status ===
          "LEFT"
        ) {
          callback({
            ok: false,
            message:
              "คุณออกจากห้องแล้ว",
          });

          return;
        }

        const timer =
          disconnectTimers.get(
            player.id
          );

        if (timer) {
          clearTimeout(
            timer
          );

          disconnectTimers.delete(
            player.id
          );
        }

        player.socketId =
          socket.id;

        player.status =
          "ACTIVE";

        player.disconnectedAt =
          null;

        socket.join(
          room.code
        );

        callback({
          ok: true,

          playerId:
            player.id,

          room:
            publicRoom(
              room
            ),
        });

        sendState(
          room
        );
      }
    );

    socket.on(
      "disconnect",
      () => {
        const found =
          findBySocket(
            socket.id
          );

        if (!found) {
          return;
        }

        const {
          room,
          player,
        } = found;

        if (
          player.status ===
          "LEFT"
        ) {
          return;
        }

        player.socketId =
          null;

        player.status =
          "RECONNECTING";

        player.disconnectedAt =
          Date.now();

        sendState(
          room
        );

        const oldTimer =
          disconnectTimers.get(
            player.id
          );

        if (oldTimer) {
          clearTimeout(
            oldTimer
          );
        }

        // ตรงนี้ใช้ expireReconnect()
        // จาก Game Engine ล่าสุดของเรา
      }
    );
  }
);

// ======================================================
// HEALTH
// ======================================================

app.get(
  "/health",
  (_, res) => {
    res.json({
      ok: true,

      game:
        "31 Scat",

      rooms:
        rooms.size,
    });
  }
);

// ======================================================
// PRODUCTION FRONTEND
// ======================================================

const __filename =
  fileURLToPath(
    import.meta.url
  );

const __dirname =
  path.dirname(
    __filename
  );

const distPath =
  path.resolve(
    __dirname,
    "../dist"
  );

console.log(
  "Serving frontend from:",
  distPath
);

app.use(
  express.static(
    distPath
  )
);

// Express 4
app.get(
  "*",
  (_req, res) => {
    res.sendFile(
      path.join(
        distPath,
        "index.html"
      )
    );
  }
);

// ======================================================
// START SERVER
// ======================================================

const PORT =
  Number(
    process.env.PORT
  ) || 3001;

httpServer.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `🃏 31 Scat running on port ${PORT}`
    );
  }
);

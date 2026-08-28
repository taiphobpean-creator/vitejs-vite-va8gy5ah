import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

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

type Card = {
  id: string;
  suit: Suit;
  rank: Rank;
  value: number;
};

type Player = {
  id: string;
  name: string;
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
  reason:
    | "31"
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

  deck: Card[];
  discardPile: Card[];

  hands: Record<string, Card[]>;

  currentPlayerId: string | null;

  hasDrawn: boolean;

  knockedBy: string | null;

  finalTurnsRemaining: string[];

  initialTripPlayers: string[];

  result: RoundResult | null;
};

type Room = {
  code: string;
  hostId: string;
  multiplier: number;

  status:
    | "waiting"
    | "playing";

  players: Player[];

  game: GameState | null;
};

// ======================================================
// EXPRESS / SOCKET
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
  });

const rooms =
  new Map<string, Room>();

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

  let index = 0;

  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({
        id: `${index}-${rank}-${suit}`,
        suit,
        rank,
        value:
          rankValue(rank),
      });

      index++;
    }
  }

  return deck;
}

function shuffle<T>(
  items: T[]
): T[] {
  const copy = [...items];

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
  initialHand = false
) {
  // ตอง
  if (
    isThreeOfKind(hand)
  ) {
    return initialHand
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

  for (const card of hand) {
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
// PUBLIC ROOM
// ======================================================

function publicRoom(
  room: Room
) {
  return {
    code: room.code,
    hostId:
      room.hostId,

    multiplier:
      room.multiplier,

    status:
      room.status,

    players:
      room.players.map(
        (player) => ({
          id: player.id,
          name:
            player.name,
          totalChip:
            player.totalChip,
        })
      ),
  };
}

// ======================================================
// SEND PRIVATE GAME STATE
// ======================================================

function sendGameState(
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
      game
        .discardPile
        .length - 1
    ] || null;

  for (
    const player
    of room.players
  ) {
    const socket =
      io.sockets.sockets.get(
        player.id
      );

    if (!socket) {
      continue;
    }

    const opponents =
      room.players
        .filter(
          (p) =>
            p.id !==
            player.id
        )
        .map((p) => ({
          id: p.id,
          name: p.name,
          totalChip:
            p.totalChip,
          cardCount:
            game.hands[
              p.id
            ]?.length ||
            0,
        }));

    socket.emit(
      "game-state",
      {
        roundNumber:
          game.roundNumber,

        phase:
          game.phase,

        hand:
          game.hands[
            player.id
          ] || [],

        opponents,

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
      }
    );
  }
}

// ======================================================
// SETTLEMENT
// ======================================================

function settleRound(
  room: Room,
  reason:
    RoundResult["reason"]
) {
  const game =
    room.game;

  if (!game) {
    return;
  }

  const scores: Record<
    string,
    number
  > = {};

  const roundNet: Record<
    string,
    number
  > = {};

  for (
    const player
    of room.players
  ) {
    const hand =
      game.hands[
        player.id
      ];

    const wasInitialTrip =
      game.initialTripPlayers.includes(
        player.id
      );

    scores[player.id] =
      wasInitialTrip
        ? 31
        : calculateScore(
            hand,
            false
          );

    roundNet[
      player.id
    ] = 0;
  }

  const settlements:
    SettlementLine[] = [];

  for (
    let i = 0;
    i <
    room.players.length;
    i++
  ) {
    for (
      let j =
        i + 1;
      j <
      room.players.length;
      j++
    ) {
      const a =
        room.players[i];

      const b =
        room.players[j];

      const aScore =
        scores[a.id];

      const bScore =
        scores[b.id];

      if (
        aScore ===
        bScore
      ) {
        continue;
      }

      const winner =
        aScore >
        bScore
          ? a
          : b;

      const loser =
        aScore >
        bScore
          ? b
          : a;

      const winnerScore =
        scores[
          winner.id
        ];

      const loserScore =
        scores[
          loser.id
        ];

      const difference =
        winnerScore -
        loserScore;

      // 31 ได้ double
      const bonus =
        winnerScore === 31
          ? 2
          : 1;

      const chips =
        difference *
        room.multiplier *
        bonus;

      roundNet[
        winner.id
      ] += chips;

      roundNet[
        loser.id
      ] -= chips;

      settlements.push({
        winnerId:
          winner.id,

        loserId:
          loser.id,

        difference,

        multiplier:
          room.multiplier,

        bonus,

        chips,
      });
    }
  }

  // Safety:
  // ผลรวมต้องเป็น 0
  const total =
    Object.values(
      roundNet
    ).reduce(
      (sum, value) =>
        sum + value,
      0
    );

  if (
    Math.abs(total) >
    0.000001
  ) {
    console.error(
      "Settlement error:",
      total
    );
  }

  for (
    const player
    of room.players
  ) {
    player.totalChip +=
      roundNet[
        player.id
      ];
  }

  game.phase =
    "showdown";

  game.currentPlayerId =
    null;

  game.hasDrawn =
    false;

  game.result = {
    roundNumber:
      game.roundNumber,

    reason,

    scores,
    roundNet,
    settlements,
  };

  sendGameState(room);
}

// ======================================================
// START ROUND
// ======================================================

function startRound(
  room: Room
) {
  let deck =
    shuffle(
      createDeck()
    );

  const hands: Record<
    string,
    Card[]
  > = {};

  for (
    const player
    of room.players
  ) {
    hands[
      player.id
    ] = [];
  }

  // แจกวนทีละใบ 3 รอบ
  for (
    let round = 0;
    round < 3;
    round++
  ) {
    for (
      const player
      of room.players
    ) {
      const card =
        deck.pop();

      if (card) {
        hands[
          player.id
        ].push(card);
      }
    }
  }

  const previousRound =
    room.game
      ?.roundNumber || 0;

  const initialTrips =
    room.players
      .filter(
        (player) =>
          isThreeOfKind(
            hands[
              player.id
            ]
          )
      )
      .map(
        (player) =>
          player.id
      );

  room.status =
    "playing";

  room.game = {
    roundNumber:
      previousRound + 1,

    phase:
      "playing",

    deck,

    discardPile:
      [],

    hands,

    currentPlayerId:
      room.players[0]
        ?.id || null,

    hasDrawn:
      false,

    knockedBy:
      null,

    finalTurnsRemaining:
      [],

    initialTripPlayers:
      initialTrips,

    result:
      null,
  };

  // ตองตั้งแต่แจก
  // จบรอบทันที
  if (
    initialTrips.length >
    0
  ) {
    settleRound(
      room,
      "initial-trip"
    );

    return;
  }

  // เปิด discard ใบแรก
  const firstDiscard =
    room.game.deck.pop();

  if (firstDiscard) {
    room.game.discardPile.push(
      firstDiscard
    );
  }

  sendGameState(room);
}

// ======================================================
// ADVANCE NORMAL TURN
// ======================================================

function advanceTurn(
  room: Room
) {
  const game =
    room.game;

  if (
    !game ||
    !game.currentPlayerId
  ) {
    return;
  }

  const index =
    room.players.findIndex(
      (player) =>
        player.id ===
        game.currentPlayerId
    );

  if (
    index === -1
  ) {
    return;
  }

  const nextIndex =
    (index + 1) %
    room.players.length;

  game.currentPlayerId =
    room.players[
      nextIndex
    ].id;

  game.hasDrawn =
    false;
}

// ======================================================
// FINAL ROUND ADVANCE
// ======================================================

function advanceFinalTurn(
  room: Room
) {
  const game =
    room.game;

  if (!game) {
    return;
  }

  // คนปัจจุบันเล่นจบแล้ว
  if (
    game
      .finalTurnsRemaining
      .length >
    0
  ) {
    game.finalTurnsRemaining.shift();
  }

  if (
    game
      .finalTurnsRemaining
      .length === 0
  ) {
    settleRound(
      room,
      "knock"
    );

    return;
  }

  game.currentPlayerId =
    game
      .finalTurnsRemaining[0];

  game.hasDrawn =
    false;

  sendGameState(room);
}

// ======================================================
// REBUILD DECK
// ======================================================

function rebuildDeckIfNeeded(
  game: GameState
) {
  if (
    game.deck.length >
    0
  ) {
    return;
  }

  if (
    game
      .discardPile
      .length <= 1
  ) {
    return;
  }

  const top =
    game.discardPile.pop()!;

  game.deck =
    shuffle(
      game.discardPile
    );

  game.discardPile =
    [top];
}

// ======================================================
// SOCKET EVENTS
// ======================================================

io.on(
  "connection",
  (socket) => {
    console.log(
      "🟢 Connected:",
      socket.id
    );

    // --------------------------------------------------
    // CREATE ROOM
    // --------------------------------------------------

    socket.on(
      "create-room",
      (
        data: {
          name: string;
          multiplier:
            number;
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

        const room: Room =
          {
            code,

            hostId:
              socket.id,

            multiplier:
              Number(
                data.multiplier
              ) || 1,

            status:
              "waiting",

            players: [
              {
                id:
                  socket.id,

                name:
                  data.name?.trim() ||
                  "Player",

                totalChip: 0,
              },
            ],

            game: null,
          };

        rooms.set(
          code,
          room
        );

        socket.join(code);

        callback({
          ok: true,
          room:
            publicRoom(
              room
            ),
        });

        sendGameState(
          room
        );
      }
    );

    // --------------------------------------------------
    // JOIN
    // --------------------------------------------------

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
          room.status !==
          "waiting"
        ) {
          callback({
            ok: false,
            message:
              "เกมเริ่มแล้ว",
          });

          return;
        }

        if (
          room.players
            .length >= 8
        ) {
          callback({
            ok: false,
            message:
              "ห้องเต็มแล้ว",
          });

          return;
        }

        room.players.push({
          id:
            socket.id,

          name:
            data.name?.trim() ||
            "Player",

          totalChip: 0,
        });

        socket.join(
          code
        );

        callback({
          ok: true,
          room:
            publicRoom(
              room
            ),
        });

        sendGameState(
          room
        );
      }
    );

    // --------------------------------------------------
    // START GAME
    // --------------------------------------------------

    socket.on(
      "start-game",
      (
        data: {
          code: string;
        },
        callback
      ) => {
        const room =
          rooms.get(
            data.code
              .toUpperCase()
          );

        if (!room) {
          callback({
            ok: false,
            message:
              "ไม่พบห้อง",
          });

          return;
        }

        if (
          room.hostId !==
          socket.id
        ) {
          callback({
            ok: false,
            message:
              "เฉพาะ Host เท่านั้น",
          });

          return;
        }

        if (
          room.players
            .length < 2
        ) {
          callback({
            ok: false,
            message:
              "ต้องมีอย่างน้อย 2 คน",
          });

          return;
        }

        startRound(room);

        callback({
          ok: true,
        });
      }
    );

    // --------------------------------------------------
    // DRAW DECK
    // --------------------------------------------------

    socket.on(
      "draw-deck",
      (
        data: {
          code: string;
        },
        callback
      ) => {
        const room =
          rooms.get(
            data.code
          );

        const game =
          room?.game;

        if (
          !room ||
          !game
        ) {
          callback({
            ok: false,
          });

          return;
        }

        if (
          game.phase !==
            "playing" &&
          game.phase !==
            "final-round"
        ) {
          callback({
            ok: false,
            message:
              "รอบจบแล้ว",
          });

          return;
        }

        if (
          game.currentPlayerId !==
          socket.id
        ) {
          callback({
            ok: false,
            message:
              "ยังไม่ถึงตาคุณ",
          });

          return;
        }

        if (
          game.hasDrawn
        ) {
          callback({
            ok: false,
            message:
              "คุณจั่วแล้ว",
          });

          return;
        }

        rebuildDeckIfNeeded(
          game
        );

        const card =
          game.deck.pop();

        if (!card) {
          callback({
            ok: false,
            message:
              "ไม่มีไพ่ให้จั่ว",
          });

          return;
        }

        game.hands[
          socket.id
        ].push(card);

        game.hasDrawn =
          true;

        sendGameState(
          room
        );

        callback({
          ok: true,
        });
      }
    );

    // --------------------------------------------------
    // DRAW DISCARD
    // --------------------------------------------------

    socket.on(
      "draw-discard",
      (
        data: {
          code: string;
        },
        callback
      ) => {
        const room =
          rooms.get(
            data.code
          );

        const game =
          room?.game;

        if (
          !room ||
          !game
        ) {
          callback({
            ok: false,
          });

          return;
        }

        if (
          game.currentPlayerId !==
          socket.id
        ) {
          callback({
            ok: false,
            message:
              "ยังไม่ถึงตาคุณ",
          });

          return;
        }

        if (
          game.hasDrawn
        ) {
          callback({
            ok: false,
            message:
              "คุณจั่วแล้ว",
          });

          return;
        }

        const card =
          game.discardPile.pop();

        if (!card) {
          callback({
            ok: false,
            message:
              "ไม่มีกองทิ้ง",
          });

          return;
        }

        game.hands[
          socket.id
        ].push(card);

        game.hasDrawn =
          true;

        sendGameState(
          room
        );

        callback({
          ok: true,
        });
      }
    );

    // --------------------------------------------------
    // DISCARD
    // --------------------------------------------------

    socket.on(
      "discard-card",
      (
        data: {
          code: string;
          cardId: string;
        },
        callback
      ) => {
        const room =
          rooms.get(
            data.code
          );

        const game =
          room?.game;

        if (
          !room ||
          !game
        ) {
          callback({
            ok: false,
          });

          return;
        }

        if (
          game.currentPlayerId !==
          socket.id
        ) {
          callback({
            ok: false,
            message:
              "ยังไม่ถึงตาคุณ",
          });

          return;
        }

        if (
          !game.hasDrawn
        ) {
          callback({
            ok: false,
            message:
              "ต้องจั่วไพ่ก่อน",
          });

          return;
        }

        const hand =
          game.hands[
            socket.id
          ];

        const index =
          hand.findIndex(
            (card) =>
              card.id ===
              data.cardId
          );

        if (
          index === -1
        ) {
          callback({
            ok: false,
            message:
              "ไม่พบไพ่",
          });

          return;
        }

        const [
          discarded,
        ] =
          hand.splice(
            index,
            1
          );

        game.discardPile.push(
          discarded
        );

        game.hasDrawn =
          false;

        const score =
          calculateScore(
            hand,
            false
          );

        // 31 ก่อน Knock
        if (
          score === 31 &&
          game.phase ===
            "playing"
        ) {
          settleRound(
            room,
            "31"
          );

          callback({
            ok: true,
          });

          return;
        }

        // Final Round
        // ต่อให้ 31 ก็ต้องเล่นจนครบ
        if (
          game.phase ===
          "final-round"
        ) {
          advanceFinalTurn(
            room
          );

          callback({
            ok: true,
          });

          return;
        }

        advanceTurn(
          room
        );

        sendGameState(
          room
        );

        callback({
          ok: true,
        });
      }
    );

    // --------------------------------------------------
    // KNOCK
    // --------------------------------------------------

    socket.on(
      "knock",
      (
        data: {
          code: string;
        },
        callback
      ) => {
        const room =
          rooms.get(
            data.code
          );

        const game =
          room?.game;

        if (
          !room ||
          !game
        ) {
          callback({
            ok: false,
          });

          return;
        }

        if (
          game.phase !==
          "playing"
        ) {
          callback({
            ok: false,
            message:
              "เคาะไม่ได้",
          });

          return;
        }

        if (
          game.currentPlayerId !==
          socket.id
        ) {
          callback({
            ok: false,
            message:
              "ยังไม่ถึงตาคุณ",
          });

          return;
        }

        if (
          game.hasDrawn
        ) {
          callback({
            ok: false,
            message:
              "ต้อง Knock ก่อนจั่ว",
          });

          return;
        }

        const currentIndex =
          room.players.findIndex(
            (player) =>
              player.id ===
              socket.id
          );

        const finalTurns:
          string[] = [];

        for (
          let step = 1;
          step <
          room.players.length;
          step++
        ) {
          const index =
            (currentIndex +
              step) %
            room.players
              .length;

          finalTurns.push(
            room.players[
              index
            ].id
          );
        }

        game.phase =
          "final-round";

        game.knockedBy =
          socket.id;

        game.finalTurnsRemaining =
          finalTurns;

        game.currentPlayerId =
          finalTurns[0] ||
          null;

        game.hasDrawn =
          false;

        if (
          finalTurns.length ===
          0
        ) {
          settleRound(
            room,
            "knock"
          );
        } else {
          sendGameState(
            room
          );
        }

        callback({
          ok: true,
        });
      }
    );

    // --------------------------------------------------
    // NEXT ROUND
    // --------------------------------------------------

    socket.on(
      "next-round",
      (
        data: {
          code: string;
        },
        callback
      ) => {
        const room =
          rooms.get(
            data.code
          );

        if (!room) {
          callback({
            ok: false,
          });

          return;
        }

        if (
          room.hostId !==
          socket.id
        ) {
          callback({
            ok: false,
            message:
              "เฉพาะ Host",
          });

          return;
        }

        if (
          room.game
            ?.phase !==
          "showdown"
        ) {
          callback({
            ok: false,
            message:
              "รอบยังไม่จบ",
          });

          return;
        }

        startRound(
          room
        );

        callback({
          ok: true,
        });
      }
    );

    // --------------------------------------------------
    // DISCONNECT
    // --------------------------------------------------

    socket.on(
      "disconnect",
      () => {
        console.log(
          "🔴 Disconnected:",
          socket.id
        );

        for (
          const [
            code,
            room,
          ] of rooms
        ) {
          const index =
            room.players.findIndex(
              (player) =>
                player.id ===
                socket.id
            );

          if (
            index === -1
          ) {
            continue;
          }

          room.players.splice(
            index,
            1
          );

          if (
            room.game
          ) {
            delete room.game
              .hands[
              socket.id
            ];

            room.game.finalTurnsRemaining =
              room.game.finalTurnsRemaining.filter(
                (id) =>
                  id !==
                  socket.id
              );

            if (
              room.game
                .currentPlayerId ===
              socket.id
            ) {
              room.game.currentPlayerId =
                room.players[0]
                  ?.id ||
                null;

              room.game.hasDrawn =
                false;
            }
          }

          if (
            room.players
              .length === 0
          ) {
            rooms.delete(
              code
            );

            continue;
          }

          if (
            room.hostId ===
            socket.id
          ) {
            room.hostId =
              room.players[0]
                .id;
          }

          sendGameState(
            room
          );
        }
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
        "31 Scat Phase 2",
      rooms:
        rooms.size,
    });
  }
);

// ======================================================
// STATIC WEB
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
  path.join(
    __dirname,
    "../dist"
  );

app.use(
  express.static(
    distPath
  )
);

app.get(
  "*",
  (_, res) => {
    res.sendFile(
      path.join(
        distPath,
        "index.html"
      )
    );
  }
);

// ======================================================
// SERVER
// ======================================================

const PORT =
  Number(
    process.env.PORT
  ) || 3001;

httpServer.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log("");
    console.log(
      "🃏 31 Scat Phase 2"
    );

    console.log(
      `🚀 http://localhost:${PORT}`
    );

    console.log("");
  }
);

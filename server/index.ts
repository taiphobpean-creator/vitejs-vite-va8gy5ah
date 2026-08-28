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
// SERVER
// ======================================================

const app =
  express();

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
  new Map<
    string,
    Room
  >();

// ======================================================
// CONSTANTS
// ======================================================

const EMOJI_COOLDOWN_MS =
  400;

const EMOJI_MAX_PER_ROUND =
  10;

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
  if (
    rank === "A"
  ) {
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

function createDeck():
  Card[] {
  const deck: Card[] =
    [];

  let index = 0;

  for (
    const suit
    of suits
  ) {
    for (
      const rank
      of ranks
    ) {
      deck.push({
        id:
          `${Date.now()}-${index}-${rank}-${suit}`,

        suit,

        rank,

        value:
          rankValue(
            rank
          ),
      });

      index++;
    }
  }

  return deck;
}

function shuffle<T>(
  items: T[]
): T[] {
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
  initialHand = false
) {
  if (
    isThreeOfKind(
      hand
    )
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

  let code = "";

  for (
    let i = 0;
    i < 4;
    i++
  ) {
    code +=
      chars[
        Math.floor(
          Math.random() *
            chars.length
        )
      ];
  }

  return code;
}

// ======================================================
// LEDGER
// ======================================================

function initLedgerPlayer(
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
      ][player.id] =
        0;
    }

    if (
      room.ledger[
        player.id
      ][playerId] ===
      undefined
    ) {
      room.ledger[
        player.id
      ][playerId] =
        0;
    }
  }
}

function updateLedger(
  room: Room,
  winnerId: string,
  loserId: string,
  chips: number
) {
  initLedgerPlayer(
    room,
    winnerId
  );

  initLedgerPlayer(
    room,
    loserId
  );

  room.ledger[
    winnerId
  ][loserId] +=
    chips;

  room.ledger[
    loserId
  ][winnerId] -=
    chips;
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

function activePlayers(
  room: Room
): Player[] {
  if (
    !room.game
  ) {
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
// NEXT STARTER
// ======================================================

function determineNextStarter(
  room: Room
) {
  if (
    room.history.length ===
    0
  ) {
    return room.hostId;
  }

  const previous =
    room.history[
      room.history.length -
        1
    ];

  const candidates =
    room.players.filter(
      (player) =>
        previous.scores[
          player.id
        ] !== undefined
    );

  if (
    candidates.length ===
    0
  ) {
    return room.hostId;
  }

  const highestScore =
    Math.max(
      ...candidates.map(
        (player) =>
          previous.scores[
            player.id
          ]
      )
    );

  let tied =
    candidates.filter(
      (player) =>
        previous.scores[
          player.id
        ] ===
        highestScore
    );

  if (
    tied.length === 1
  ) {
    return tied[0].id;
  }

  // ------------------------------------------
  // Tie breaker:
  // Head-to-head accumulated Chip
  // ------------------------------------------

  const chipScores =
    tied.map(
      (player) => {
        let chip = 0;

        for (
          const opponent
          of tied
        ) {
          if (
            opponent.id ===
            player.id
          ) {
            continue;
          }

          chip +=
            room.ledger[
              player.id
            ]?.[
              opponent.id
            ] || 0;
        }

        return {
          player,
          chip,
        };
      }
    );

  const bestChip =
    Math.max(
      ...chipScores.map(
        (item) =>
          item.chip
      )
    );

  tied =
    chipScores
      .filter(
        (item) =>
          item.chip ===
          bestChip
      )
      .map(
        (item) =>
          item.player
      );

  if (
    tied.length === 1
  ) {
    return tied[0].id;
  }

  // ยังเสมอ:
  // Seat order

  for (
    const player
    of room.players
  ) {
    if (
      tied.some(
        (item) =>
          item.id ===
          player.id
      )
    ) {
      return player.id;
    }
  }

  return room.hostId;
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

    players:
      room.players.map(
        (player) => ({
          id:
            player.id,

          name:
            player.name,

          totalChip:
            player.totalChip,
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

function sendGameState(
  room: Room
) {
  io.to(
    room.code
  ).emit(
    "room-update",
    publicRoom(room)
  );

  if (
    !room.game
  ) {
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
    const playerSocket =
      io.sockets.sockets.get(
        player.id
      );

    if (
      !playerSocket
    ) {
      continue;
    }

    const isActive =
      game.activePlayerIds.includes(
        player.id
      );

    const tablePlayers =
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
        );

    playerSocket.emit(
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

        activeInRound:
          isActive,

        tablePlayers,

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
                room.emojiUsage[
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
// SETTLEMENT
// ======================================================

function settleRound(
  room: Room,
  reason:
    RoundResult["reason"]
) {
  const game =
    room.game;

  if (
    !game
  ) {
    return;
  }

  // IMPORTANT:
  // ใช้เฉพาะคนที่อยู่ในรอบนี้
  //
  // คน Join กลางรอบจะไม่มีสิทธิ์
  // ได้/เสีย Chip
  const players =
    activePlayers(room);

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
    of players
  ) {
    if (
      !game.activePlayerIds.includes(
        player.id
      )
    ) {
      continue;
    }

    const hand =
      game.hands[
        player.id
      ] || [];

    const initialTrip =
      game.initialTripPlayers.includes(
        player.id
      );

    scores[
      player.id
    ] =
      initialTrip
        ? 31
        : calculateScore(
            hand
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
    players.length;
    i++
  ) {
    for (
      let j =
        i + 1;
      j <
      players.length;
      j++
    ) {
      const a =
        players[i];

      const b =
        players[j];

      // Safety อีกชั้น
      if (
        !game.activePlayerIds.includes(
          a.id
        ) ||
        !game.activePlayerIds.includes(
          b.id
        )
      ) {
        continue;
      }

      const scoreA =
        scores[a.id];

      const scoreB =
        scores[b.id];

      if (
        scoreA === undefined ||
        scoreB === undefined
      ) {
        continue;
      }

      // เสมอ = ไม่เสียกัน
      if (
        scoreA ===
        scoreB
      ) {
        continue;
      }

      const winner =
        scoreA >
        scoreB
          ? a
          : b;

      const loser =
        scoreA >
        scoreB
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

      // 31 ได้โบนัส x2
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

      // Safety:
      // อัปเดตเฉพาะ active
      if (
        game.activePlayerIds.includes(
          winner.id
        ) &&
        game.activePlayerIds.includes(
          loser.id
        )
      ) {
        winner.totalChip +=
          chips;

        loser.totalChip -=
          chips;

        updateLedger(
          room,
          winner.id,
          loser.id,
          chips
        );
      }

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

  const total =
    Object.values(
      roundNet
    ).reduce(
      (
        sum,
        value
      ) =>
        sum + value,
      0
    );

  if (
    Math.abs(total) >
    0.000001
  ) {
    console.error(
      "Settlement is not zero:",
      total
    );
  }

  const result:
    RoundResult = {
      roundNumber:
        game.roundNumber,

      starterId:
        game.starterId,

      reason,

      scores,

      roundNet,

      settlements,
    };

  room.history.push(
    result
  );

  game.phase =
    "showdown";

  game.currentPlayerId =
    null;

  game.hasDrawn =
    false;

  game.result =
    result;

  sendGameState(
    room
  );
}

// ======================================================
// START ROUND
// ======================================================

type StartRoundOptions = {
  roundNumber?:
    number;

  starterId?:
    string;

  isRestart?:
    boolean;
};

function startRound(
  room: Room,
  options:
    StartRoundOptions = {}
) {
  if (
    room.players.length <
    2
  ) {
    return;
  }

  let deck =
    shuffle(
      createDeck()
    );

  const allIds =
    room.players.map(
      (player) =>
        player.id
    );

  let starterId:
    string;

  if (
    options.starterId &&
    allIds.includes(
      options.starterId
    )
  ) {
    starterId =
      options.starterId;
  } else if (
    room.history.length ===
    0
  ) {
    starterId =
      room.hostId;
  } else {
    starterId =
      determineNextStarter(
        room
      );
  }

  if (
    !allIds.includes(
      starterId
    )
  ) {
    starterId =
      allIds[0];
  }

  const starterIndex =
    allIds.indexOf(
      starterId
    );

  const orderedIds =
    starterIndex >= 0
      ? [
          ...allIds.slice(
            starterIndex
          ),

          ...allIds.slice(
            0,
            starterIndex
          ),
        ]
      : allIds;

  const hands: Record<
    string,
    Card[]
  > = {};

  for (
    const id
    of orderedIds
  ) {
    hands[id] =
      [];
  }

  // แจกไพ่ 3 ใบ
  for (
    let round = 0;
    round < 3;
    round++
  ) {
    for (
      const id
      of orderedIds
    ) {
      const card =
        deck.pop();

      if (
        card
      ) {
        hands[
          id
        ].push(card);
      }
    }
  }

  const initialTrips =
    orderedIds.filter(
      (id) =>
        isThreeOfKind(
          hands[id]
        )
    );

  const nextRoundNumber =
    options.roundNumber ??
    (
      (
        room.game
          ?.roundNumber ||
        0
      ) + 1
    );

  room.status =
    "playing";

  // Reset Emoji ทุกครั้งที่เริ่มรอบ
  room.emojiUsage =
    {};

  for (
    const player
    of room.players
  ) {
    room.emojiUsage[
      player.id
    ] = {
      count: 0,
      lastAt: 0,
    };
  }

  room.game = {
    roundNumber:
      nextRoundNumber,

    phase:
      "playing",

    activePlayerIds:
      orderedIds,

    starterId,

    deck,

    discardPile:
      [],

    hands,

    currentPlayerId:
      starterId,

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

  // ------------------------------------------
  // กฎเดิม:
  // ตองจากไพ่แจกแรก = 31
  // จบรอบทันที
  // ------------------------------------------

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

  // เปิดไพ่กองทิ้ง
  const firstDiscard =
    room.game.deck.pop();

  if (
    firstDiscard
  ) {
    room.game.discardPile.push(
      firstDiscard
    );
  }

  sendGameState(
    room
  );
}

// ======================================================
// RESTART VOID ROUND
// ======================================================

function restartVoidRound(
  room: Room,
  oldRoundNumber: number,
  oldStarterId:
    string
) {
  if (
    room.players.length <
    2
  ) {
    room.status =
      "waiting";

    room.game =
      null;

    sendGameState(
      room
    );

    return;
  }

  let starterId =
    oldStarterId;

  if (
    !room.players.some(
      (player) =>
        player.id ===
        starterId
    )
  ) {
    starterId =
      room.hostId;
  }

  console.log(
    `♻️ Round ${oldRoundNumber} VOID -> Restart`
  );

  startRound(
    room,
    {
      roundNumber:
        oldRoundNumber,

      starterId,

      isRestart:
        true,
    }
  );
}

// ======================================================
// TURN
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

  const ids =
    game.activePlayerIds;

  const index =
    ids.indexOf(
      game.currentPlayerId
    );

  if (
    index === -1
  ) {
    return;
  }

  const nextIndex =
    (index + 1) %
    ids.length;

  game.currentPlayerId =
    ids[nextIndex];

  game.hasDrawn =
    false;
}

function advanceFinalTurn(
  room: Room
) {
  const game =
    room.game;

  if (
    !game
  ) {
    return;
  }

  if (
    game.finalTurnsRemaining
      .length > 0
  ) {
    game.finalTurnsRemaining.shift();
  }

  if (
    game.finalTurnsRemaining
      .length === 0
  ) {
    settleRound(
      room,
      "knock"
    );

    return;
  }

  game.currentPlayerId =
    game.finalTurnsRemaining[
      0
    ];

  game.hasDrawn =
    false;

  sendGameState(
    room
  );
}

// ======================================================
// REBUILD DECK
// ======================================================

function rebuildDeck(
  game: GameState
) {
  if (
    game.deck.length >
    0
  ) {
    return;
  }

  if (
    game.discardPile
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
// SOCKET
// ======================================================

io.on(
  "connection",
  (socket) => {
    console.log(
      "🟢 Connected:",
      socket.id
    );

    // ==================================================
    // CREATE ROOM
    // ==================================================

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
          rooms.has(
            code
          )
        ) {
          code =
            createRoomCode();
        }

        const player:
          Player = {
          id:
            socket.id,

          name:
            data.name
              ?.trim() ||
            "Player",

          totalChip:
            0,
        };

        const room:
          Room = {
          code,

          hostId:
            socket.id,

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

        initLedgerPlayer(
          room,
          player.id
        );

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

    // ==================================================
    // JOIN ROOM
    // ==================================================

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
          rooms.get(
            code
          );

        if (
          !room
        ) {
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
              "เกมนี้จบแล้ว",
          });

          return;
        }

        if (
          room.players
            .length >= 10
        ) {
          callback({
            ok: false,

            message:
              "ห้องเต็มแล้ว",
          });

          return;
        }

        const player:
          Player = {
          id:
            socket.id,

          name:
            data.name
              ?.trim() ||
            "Player",

          totalChip:
            0,
        };

        room.players.push(
          player
        );

        initLedgerPlayer(
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
          code
        );

        callback({
          ok: true,

          room:
            publicRoom(
              room
            ),
        });

        // คนเข้ากลางรอบ
        // อยู่ใน room.players
        // แต่ยังไม่อยู่ activePlayerIds
        sendGameState(
          room
        );
      }
    );

    // ==================================================
    // START GAME
    // ==================================================

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

        if (
          !room
        ) {
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
              "เฉพาะ Host",
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

        startRound(
          room
        );

        callback({
          ok: true,
        });
      }
    );

    // ==================================================
    // DRAW DECK
    // ==================================================

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
          !game.activePlayerIds.includes(
            socket.id
          )
        ) {
          callback({
            ok: false,

            message:
              "รอเล่นรอบหน้า",
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

        rebuildDeck(
          game
        );

        const card =
          game.deck.pop();

        if (
          !card
        ) {
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

    // ==================================================
    // DRAW DISCARD
    // ==================================================

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
          !game.activePlayerIds.includes(
            socket.id
          )
        ) {
          callback({
            ok: false,

            message:
              "รอเล่นรอบหน้า",
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

        if (
          !card
        ) {
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

    // ==================================================
    // DISCARD
    // ==================================================

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
          !game.activePlayerIds.includes(
            socket.id
          )
        ) {
          callback({
            ok: false,

            message:
              "คุณไม่ได้อยู่ในรอบนี้",
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
              "ต้องจั่วก่อน",
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

        // =================================================
        // IMPORTANT FIX:
        //
        // ไม่เช็ก 31 แล้วจบรอบตรงนี้
        //
        // ต่อให้ผู้เล่นมี 31
        // คนถัดไปก็ยังเล่นต่อ
        //
        // 31 จะมีผลเป็นโบนัส x2
        // ตอน Showdown เท่านั้น
        // =================================================

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

    // ==================================================
    // KNOCK
    // ==================================================

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
          !game.activePlayerIds.includes(
            socket.id
          )
        ) {
          callback({
            ok: false,

            message:
              "คุณไม่ได้อยู่ในรอบนี้",
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
              "ไม่สามารถ Knock ได้",
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

        const ids =
          game.activePlayerIds;

        const index =
          ids.indexOf(
            socket.id
          );

        const finalTurns:
          string[] = [];

        for (
          let step = 1;
          step <
          ids.length;
          step++
        ) {
          finalTurns.push(
            ids[
              (
                index +
                step
              ) %
                ids.length
            ]
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

    // ==================================================
    // NEXT ROUND
    // ==================================================

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

        if (
          !room
        ) {
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

    // ==================================================
    // EMOJI
    // ==================================================

    socket.on(
      "emoji-reaction",
      (
        data: {
          code: string;
          emoji: string;
        },
        callback
      ) => {
        const room =
          rooms.get(
            data.code
          );

        if (
          !room ||
          room.status ===
            "ended"
        ) {
          callback?.({
            ok: false,
          });

          return;
        }

        const player =
          findPlayer(
            room,
            socket.id
          );

        if (
          !player
        ) {
          callback?.({
            ok: false,
          });

          return;
        }

        if (
          !ALLOWED_EMOJIS.includes(
            data.emoji
          )
        ) {
          callback?.({
            ok: false,
          });

          return;
        }

        if (
          !room.emojiUsage[
            socket.id
          ]
        ) {
          room.emojiUsage[
            socket.id
          ] = {
            count: 0,
            lastAt: 0,
          };
        }

        const usage =
          room.emojiUsage[
            socket.id
          ];

        const now =
          Date.now();

        // -----------------------------------------------
        // จำกัด 10 ครั้งต่อรอบ
        // -----------------------------------------------

        if (
          usage.count >=
          EMOJI_MAX_PER_ROUND
        ) {
          callback?.({
            ok: false,

            message:
              "Emoji ครบ 10 ครั้งในรอบนี้แล้ว",

            remaining:
              0,
          });

          return;
        }

        // -----------------------------------------------
        // Cooldown
        // -----------------------------------------------

        const elapsed =
          now -
          usage.lastAt;

        if (
          elapsed <
          EMOJI_COOLDOWN_MS
        ) {
          callback?.({
            ok: false,

            message:
              "กดเร็วเกินไป",

            remaining:
              EMOJI_MAX_PER_ROUND -
              usage.count,
          });

          return;
        }

        usage.count++;

        usage.lastAt =
          now;

        const remaining =
          Math.max(
            0,
            EMOJI_MAX_PER_ROUND -
              usage.count
          );

        io.to(
          room.code
        ).emit(
          "emoji-reaction",
          {
            id:
              `${socket.id}-${Date.now()}-${Math.random()}`,

            playerId:
              socket.id,

            name:
              player.name,

            emoji:
              data.emoji,

            seed:
              Math.random(),

            remaining,
          }
        );

        callback?.({
          ok: true,

          remaining,
        });
      }
    );

    // ==================================================
    // END GAME
    // ==================================================

    socket.on(
      "end-game",
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

        if (
          !room
        ) {
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

        room.status =
          "ended";

        if (
          room.game
        ) {
          room.game.currentPlayerId =
            null;
        }

        sendGameState(
          room
        );

        callback({
          ok: true,
        });
      }
    );

    // ==================================================
    // DISCONNECT
    // ==================================================

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
          const playerIndex =
            room.players.findIndex(
              (player) =>
                player.id ===
                socket.id
            );

          if (
            playerIndex ===
            -1
          ) {
            continue;
          }

          const game =
            room.game;

          const wasActive =
            Boolean(
              game &&
              game.phase !==
                "showdown" &&
              game.activePlayerIds.includes(
                socket.id
              )
            );

          const oldRoundNumber =
            game
              ?.roundNumber ||
            0;

          const oldStarterId =
            game
              ?.starterId ||
            room.hostId;

          // -----------------------------------------------
          // ลบ Player
          // -----------------------------------------------

          room.players.splice(
            playerIndex,
            1
          );

          // -----------------------------------------------
          // เปลี่ยน Host ถ้าจำเป็น
          // -----------------------------------------------

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

          delete room.emojiUsage[
            socket.id
          ];

          // =================================================
          // ACTIVE PLAYER ออกกลางรอบ
          //
          // รอบนั้น VOID
          // ไม่คิด Chip
          // ไม่บันทึก History
          // เริ่มรอบเดิมใหม่
          // =================================================

          if (
            wasActive &&
            room.status ===
              "playing"
          ) {
            restartVoidRound(
              room,
              oldRoundNumber,
              oldStarterId
            );

            continue;
          }

          // -----------------------------------------------
          // คน Waiting ออก
          // หรือออกตอน Showdown
          // ไม่ต้อง Void
          // -----------------------------------------------

          if (
            room.game
          ) {
            delete room.game
              .hands[
              socket.id
            ];

            room.game.activePlayerIds =
              room.game.activePlayerIds.filter(
                (id) =>
                  id !==
                  socket.id
              );

            room.game.finalTurnsRemaining =
              room.game.finalTurnsRemaining.filter(
                (id) =>
                  id !==
                  socket.id
              );
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
        "31 Scat Phase 3.1",

      rooms:
        rooms.size,
    });
  }
);

// ======================================================
// STATIC
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
// START
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
      "🃏 31 Scat Phase 3.1"
    );

    console.log(
      `🚀 http://localhost:${PORT}`
    );

    console.log("");
  }
);

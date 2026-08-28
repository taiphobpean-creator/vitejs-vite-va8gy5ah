import express from "express";
import { createServer } from "http";
import { Server, Socket } from "socket.io";

import path from "path";

import {
  fileURLToPath,
} from "url";

import crypto from "crypto";

// ======================================================
// CONFIG
// ======================================================

const RECONNECT_GRACE_MS =
  5 * 60 * 1000;

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
// TYPES
// ======================================================

type Suit =
  | "♠"
  | "♥"
  | "♦"
  | "♣";

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

  socketId:
    | string
    | null;

  status:
    PlayerStatus;

  disconnectedAt:
    | number
    | null;

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

  scores:
    Record<
      string,
      number
    >;

  roundNet:
    Record<
      string,
      number
    >;

  settlements:
    SettlementLine[];
};

type GameState = {
  roundNumber: number;

  phase:
    | "playing"
    | "final-round"
    | "showdown";

  activePlayerIds:
    string[];

  starterId: string;

  deck:
    Card[];

  discardPile:
    Card[];

  hands:
    Record<
      string,
      Card[]
    >;

  currentPlayerId:
    | string
    | null;

  hasDrawn: boolean;

  knockedBy:
    | string
    | null;

  finalTurnsRemaining:
    string[];

  initialTripPlayers:
    string[];

  result:
    | RoundResult
    | null;
};

type Ledger =
  Record<
    string,
    Record<
      string,
      number
    >
  >;

type EmojiUsage =
  Record<
    string,
    {
      count: number;
      lastAt: number;
    }
  >;

type Room = {
  code: string;

  hostId: string;

  multiplier:
    number;

  status:
    | "waiting"
    | "playing"
    | "ended";

  players:
    Player[];

  game:
    | GameState
    | null;

  ledger:
    Ledger;

  history:
    RoundResult[];

  emojiUsage:
    EmojiUsage;
};

// ======================================================
// SERVER
// ======================================================

const app =
  express();

const httpServer =
  createServer(app);

const io =
  new Server(
    httpServer,
    {
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

        skipMiddlewares:
          true,
      },

      pingInterval:
        25000,

      pingTimeout:
        20000,
    }
  );

const rooms =
  new Map<
    string,
    Room
  >();

const disconnectTimers =
  new Map<
    string,
    ReturnType<
      typeof setTimeout
    >
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
// CARDS
// ======================================================

const suits:
  Suit[] = [
    "♠",
    "♥",
    "♦",
    "♣",
  ];

const ranks:
  Rank[] = [
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

  return Number(
    rank
  );
}

function createDeck():
  Card[] {
  const deck:
    Card[] = [];

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
          createId(),

        suit,

        rank,

        value:
          rankValue(
            rank
          ),
      });
    }
  }

  return deck;
}

function shuffle<T>(
  data: T[]
) {
  const copy =
    [...data];

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
    hand.length !==
    3
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

  const totals:
    Record<
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
    ] +=
      card.value;
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
// PLAYER
// ======================================================

function findPlayer(
  room: Room,
  id: string
) {
  return (
    room.players.find(
      (player) =>
        player.id ===
        id
    ) ||
    null
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
    ) ||
    null
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

    if (
      player
    ) {
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
  return (
    room.players.filter(
      (player) =>
        player.status !==
        "LEFT"
    )
  );
}

function activePlayers(
  room: Room
) {
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
        player !==
        null
    );
}

function chooseNewHost(
  room: Room
) {
  const active =
    room.players.find(
      (player) =>
        player.status ===
        "ACTIVE"
    );

  if (
    active
  ) {
    room.hostId =
      active.id;

    return;
  }

  const reconnecting =
    room.players.find(
      (player) =>
        player.status ===
        "RECONNECTING"
    );

  if (
    reconnecting
  ) {
    room.hostId =
      reconnecting.id;
  }
}

// ======================================================
// LEDGER
// ======================================================

function ensureLedger(
  room: Room,
  playerId: string
) {
  room.ledger[
    playerId
  ] ??= {};

  for (
    const player
    of room.players
  ) {
    room.ledger[
      player.id
    ] ??= {};

    room.ledger[
      playerId
    ][player.id] ??=
      0;

    room.ledger[
      player.id
    ][playerId] ??=
      0;
  }
}

function updateLedger(
  room: Room,

  winnerId:
    string,

  loserId:
    string,

  chips:
    number
) {
  ensureLedger(
    room,
    winnerId
  );

  ensureLedger(
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
    livePlayers(
      room
    ).filter(
      (player) =>
        previous.scores[
          player.id
        ] !==
        undefined
    );

  if (
    candidates.length ===
    0
  ) {
    return room.hostId;
  }

  const highest =
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
        highest
    );

  if (
    tied.length ===
    1
  ) {
    return tied[0].id;
  }

  const headToHead =
    tied.map(
      (player) => {
        let total = 0;

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

          total +=
            room.ledger[
              player.id
            ]?.[
              opponent.id
            ] ||
            0;
        }

        return {
          player,
          total,
        };
      }
    );

  const best =
    Math.max(
      ...headToHead.map(
        (item) =>
          item.total
      )
    );

  tied =
    headToHead
      .filter(
        (item) =>
          item.total ===
          best
      )
      .map(
        (item) =>
          item.player
      );

  if (
    tied.length ===
    1
  ) {
    return tied[0].id;
  }

  for (
    const player
    of livePlayers(
      room
    )
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
    publicRoom(
      room
    )
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
      game.discardPile.length -
        1
    ] ||
    null;

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

    const client =
      io.sockets.sockets.get(
        player.socketId
      );

    if (
      !client
    ) {
      continue;
    }

    client.emit(
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
          ] ||
          [],

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
    RoundResult[
      "reason"
    ]
) {
  const game =
    room.game;

  if (
    !game
  ) {
    return;
  }

  // เฉพาะคนที่เล่นรอบนี้จริง
  const players =
    activePlayers(
      room
    ).filter(
      (player) =>
        player.status !==
        "LEFT"
    );

  const scores:
    Record<
      string,
      number
    > = {};

  const roundNet:
    Record<
      string,
      number
    > = {};

  for (
    const player
    of players
  ) {
    const hand =
      game.hands[
        player.id
      ] ||
      [];

    const initialTrip =
      game
        .initialTripPlayers
        .includes(
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
    SettlementLine[] =
      [];

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

      const scoreA =
        scores[a.id];

      const scoreB =
        scores[b.id];

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

      const bonus =
        winnerScore ===
        31
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

  sendState(
    room
  );
}

// ======================================================
// START ROUND
// ======================================================

function startRound(
  room: Room,

  options: {
    roundNumber?:
      number;

    starterId?:
      string;
  } = {}
) {
  const players =
    livePlayers(
      room
    );

  if (
    players.length <
    2
  ) {
    room.status =
      "waiting";

    room.game =
      null;

    sendState(
      room
    );

    return;
  }

  let deck =
    shuffle(
      createDeck()
    );

  const ids =
    players.map(
      (player) =>
        player.id
    );

  let starterId:
    string;

  if (
    options.starterId &&
    ids.includes(
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
    !ids.includes(
      starterId
    )
  ) {
    starterId =
      ids[0];
  }

  const index =
    ids.indexOf(
      starterId
    );

  const orderedIds = [
    ...ids.slice(
      index
    ),

    ...ids.slice(
      0,
      index
    ),
  ];

  const hands:
    Record<
      string,
      Card[]
    > = {};

  for (
    const id
    of orderedIds
  ) {
    hands[id] = [];
  }

  // แจกทีละใบ 3 รอบ
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
        ].push(
          card
        );
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

  const roundNumber =
    options.roundNumber ??
    (
      (
        room.game
          ?.roundNumber ||
        room.history[
          room.history.length -
            1
        ]?.roundNumber ||
        0
      ) +
      1
    );

  room.status =
    "playing";

  room.emojiUsage =
    {};

  for (
    const player
    of players
  ) {
    room.emojiUsage[
      player.id
    ] = {
      count: 0,

      lastAt: 0,
    };
  }

  room.game = {
    roundNumber,

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

  // ตองตั้งแต่แจก = 31
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

  const firstDiscard =
    room.game.deck.pop();

  if (
    firstDiscard
  ) {
    room.game
      .discardPile
      .push(
        firstDiscard
      );
  }

  sendState(
    room
  );
}

// ======================================================
// VOID ROUND
// ======================================================

function restartVoidRound(
  room: Room,

  roundNumber:
    number,

  oldStarter:
    string
) {
  let starterId =
    oldStarter;

  if (
    !livePlayers(
      room
    ).some(
      (player) =>
        player.id ===
        starterId
    )
  ) {
    starterId =
      room.hostId;
  }

  startRound(
    room,
    {
      roundNumber,

      starterId,
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

  game.currentPlayerId =
    ids[
      (
        index + 1
      ) %
        ids.length
    ];

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
    game
      .finalTurnsRemaining
      .length >
    0
  ) {
    game
      .finalTurnsRemaining
      .shift();
  }

  if (
    game
      .finalTurnsRemaining
      .length ===
    0
  ) {
    settleRound(
      room,
      "knock"
    );

    return;
  }

  game.currentPlayerId =
    game
      .finalTurnsRemaining[
      0
    ];

  game.hasDrawn =
    false;

  sendState(
    room
  );
}

// ======================================================
// DECK REBUILD
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
    game
      .discardPile
      .length <= 1
  ) {
    return;
  }

  const top =
    game
      .discardPile
      .pop()!;

  game.deck =
    shuffle(
      game.discardPile
    );

  game.discardPile =
    [top];
}

// ======================================================
// LEAVE PLAYER
// ======================================================

function leavePlayer(
  room: Room,

  player: Player,

  voidCurrentRound:
    boolean
) {
  const game =
    room.game;

  const wasActive =
    Boolean(
      game &&
      game.phase !==
        "showdown" &&
      game.activePlayerIds.includes(
        player.id
      )
    );

  const oldRound =
    game?.roundNumber ||
    0;

  const oldStarter =
    game?.starterId ||
    room.hostId;

  player.status =
    "LEFT";

  player.socketId =
    null;

  player.disconnectedAt =
    null;

  const timer =
    disconnectTimers.get(
      player.id
    );

  if (
    timer
  ) {
    clearTimeout(
      timer
    );

    disconnectTimers.delete(
      player.id
    );
  }

  if (
    room.hostId ===
    player.id
  ) {
    chooseNewHost(
      room
    );
  }

  if (
    livePlayers(
      room
    ).length ===
    0
  ) {
    room.status =
      "ended";

    sendState(
      room
    );

    return;
  }

  // ออกกลางรอบ
  // รอบโมฆะ
  if (
    voidCurrentRound &&
    wasActive &&
    room.status ===
      "playing"
  ) {
    restartVoidRound(
      room,
      oldRound,
      oldStarter
    );

    return;
  }

  if (
    game
  ) {
    delete game.hands[
      player.id
    ];

    game.activePlayerIds =
      game.activePlayerIds.filter(
        (id) =>
          id !==
          player.id
      );

    game.finalTurnsRemaining =
      game.finalTurnsRemaining.filter(
        (id) =>
          id !==
          player.id
      );

    if (
      game.currentPlayerId ===
      player.id
    ) {
      game.currentPlayerId =
        game.activePlayerIds[
          0
        ] ||
        null;

      game.hasDrawn =
        false;
    }
  }

  sendState(
    room
  );
}

// ======================================================
// RECONNECT EXPIRED
// ======================================================

function expireReconnect(
  roomCode:
    string,

  playerId:
    string
) {
  const room =
    rooms.get(
      roomCode
    );

  if (
    !room
  ) {
    return;
  }

  const player =
    findPlayer(
      room,
      playerId
    );

  if (
    !player ||
    player.status !==
      "RECONNECTING"
  ) {
    return;
  }

  // เกิน 5 นาที
  // เปลี่ยนเป็น LEFT
  // ไม่ลบ Chip / Ledger / History
  leavePlayer(
    room,
    player,
    true
  );
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
    // CREATE
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
            ) ||
            1,

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

    // ==================================================
    // JOIN
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
              "เกมจบแล้ว",
          });

          return;
        }

        if (
          livePlayers(
            room
          ).length >=
          10
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

        // ถ้าเกมกำลังเล่น
        // คนใหม่รอรอบหน้า
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

          playerId:
            string;

          playerToken:
            string;
        },

        callback
      ) => {
        const room =
          rooms.get(
            data.code
              ?.trim()
              .toUpperCase()
          );

        if (
          !room
        ) {
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
              "คุณออกจากห้องนี้แล้ว",
          });

          return;
        }

        const timer =
          disconnectTimers.get(
            player.id
          );

        if (
          timer
        ) {
          clearTimeout(
            timer
          );

          disconnectTimers.delete(
            player.id
          );
        }

        const oldSocketId =
          player.socketId;

        player.socketId =
          socket.id;

        player.status =
          "ACTIVE";

        player.disconnectedAt =
          null;

        socket.join(
          room.code
        );

        // ปิด connection เก่า
        if (
          oldSocketId &&
          oldSocketId !==
          socket.id
        ) {
          const oldSocket =
            io.sockets.sockets.get(
              oldSocketId
            );

          oldSocket?.disconnect(
            true
          );
        }

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

        const player =
          getSocketPlayer(
            room,
            socket
          );

        if (
          !player
        ) {
          callback({
            ok: false,

            message:
              "Session ไม่ถูกต้อง",
          });

          return;
        }

        if (
          room.hostId !==
          player.id
        ) {
          callback({
            ok: false,

            message:
              "เฉพาะ Host",
          });

          return;
        }

        if (
          livePlayers(
            room
          ).length <
          2
        ) {
          callback({
            ok: false,

            message:
              "ต้องมีอย่างน้อย 2 คน",
          });

          return;
        }

        if (
          room.players.some(
            (item) =>
              item.status ===
              "RECONNECTING"
          )
        ) {
          callback({
            ok: false,

            message:
              "มีผู้เล่นกำลังเชื่อมต่อกลับ กรุณารอสักครู่",
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

        const player =
          getSocketPlayer(
            room,
            socket
          );

        if (
          !player
        ) {
          callback({
            ok: false,

            message:
              "Session ไม่ถูกต้อง",
          });

          return;
        }

        if (
          !game.activePlayerIds.includes(
            player.id
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
          player.id
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
              "ไม่มีไพ่",
          });

          return;
        }

        game.hands[
          player.id
        ].push(
          card
        );

        game.hasDrawn =
          true;

        sendState(
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

        const player =
          getSocketPlayer(
            room,
            socket
          );

        if (
          !player
        ) {
          callback({
            ok: false,

            message:
              "Session ไม่ถูกต้อง",
          });

          return;
        }

        if (
          game.currentPlayerId !==
          player.id
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
          game
            .discardPile
            .pop();

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
          player.id
        ].push(
          card
        );

        game.hasDrawn =
          true;

        sendState(
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
          code:
            string;

          cardId:
            string;
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

        const player =
          getSocketPlayer(
            room,
            socket
          );

        if (
          !player
        ) {
          callback({
            ok: false,
          });

          return;
        }

        if (
          game.currentPlayerId !==
          player.id
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
            player.id
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

        // 31 ระหว่างเล่น
        // ไม่บังคับจบรอบ
        //
        // ถ้าเป็น final round
        // เล่นรอบสุดท้ายต่อให้ครบ

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

        sendState(
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
          code:
            string;
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

        const player =
          getSocketPlayer(
            room,
            socket
          );

        if (
          !player
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
              "Knock ไม่ได้",
          });

          return;
        }

        if (
          game.currentPlayerId !==
          player.id
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
            player.id
          );

        const finalTurns:
          string[] =
          [];

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
          player.id;

        game.finalTurnsRemaining =
          finalTurns;

        game.currentPlayerId =
          finalTurns[
            0
          ] ||
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
          sendState(
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

        const player =
          getSocketPlayer(
            room,
            socket
          );

        if (
          !player ||
          room.hostId !==
          player.id
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

        if (
          room.players.some(
            (item) =>
              item.status ===
              "RECONNECTING"
          )
        ) {
          callback({
            ok: false,

            message:
              "มีผู้เล่นกำลังเชื่อมต่อกลับ",
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
          code:
            string;

          emoji:
            string;
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
          getSocketPlayer(
            room,
            socket
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

        room.emojiUsage[
          player.id
        ] ??= {
          count: 0,

          lastAt: 0,
        };

        const usage =
          room.emojiUsage[
            player.id
          ];

        const now =
          Date.now();

        if (
          usage.count >=
          EMOJI_MAX_PER_ROUND
        ) {
          callback?.({
            ok: false,

            message:
              "Emoji ครบ 10 ครั้งแล้ว",

            remaining:
              0,
          });

          return;
        }

        if (
          now -
            usage.lastAt <
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
          EMOJI_MAX_PER_ROUND -
          usage.count;

        io.to(
          room.code
        ).emit(
          "emoji-reaction",
          {
            id:
              `${player.id}-${now}-${Math.random()}`,

            playerId:
              player.id,

            name:
              player.name,

            emoji:
              data.emoji,

            seed:
              Math.random(),
          }
        );

        callback?.({
          ok: true,

          remaining,
        });
      }
    );

    // ==================================================
    // LEAVE ROOM
    // ==================================================

    socket.on(
      "leave-room",
      (
        data: {
          code:
            string;
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

        const player =
          getSocketPlayer(
            room,
            socket
          );

        if (
          !player
        ) {
          callback({
            ok: false,
          });

          return;
        }

        leavePlayer(
          room,
          player,
          true
        );

        socket.leave(
          room.code
        );

        callback({
          ok: true,
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
          code:
            string;
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

        const player =
          getSocketPlayer(
            room,
            socket
          );

        if (
          !player ||
          room.hostId !==
          player.id
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

        sendState(
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
        const found =
          findBySocket(
            socket.id
          );

        if (
          !found
        ) {
          return;
        }

        const {
          room,
          player,
        } =
          found;

        // socket เก่า
        if (
          player.socketId !==
          socket.id
        ) {
          return;
        }

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

        if (
          oldTimer
        ) {
          clearTimeout(
            oldTimer
          );
        }

        const timer =
          setTimeout(
            () => {
              expireReconnect(
                room.code,
                player.id
              );
            },

            RECONNECT_GRACE_MS
          );

        disconnectTimers.set(
          player.id,
          timer
        );
      }
    );
  }
);

// ======================================================
// HEALTH
// ======================================================

app.get(
  "/health",
  (_req, res) => {
    res.json({
      ok: true,

      game:
        "31 Scat V4.2",

      reconnectSeconds:
        300,

      rooms:
        rooms.size,
    });
  }
);

// ======================================================
// SERVE REACT PRODUCTION BUILD
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

app.use(
  express.static(
    distPath
  )
);

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
// START
// ======================================================

const PORT =
  Number(
    process.env.PORT
  ) ||
  3001;

httpServer.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      ""
    );

    console.log(
      "🃏 31 SCAT V4.2"
    );

    console.log(
      "♻️ Reconnect = 5 minutes"
    );

    console.log(
      `🚀 PORT ${PORT}`
    );

    console.log(
      ""
    );
  }
);

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

  activePlayerIds: string[];

  starterId: string;

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

type Ledger = Record<
  string,
  Record<string, number>
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
};

// ======================================================
// SERVER
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
        id:
          `${Date.now()}-${index}-${rank}-${suit}`,

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
    !room.ledger[playerId]
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
  ][loserId] += chips;

  room.ledger[
    loserId
  ][winnerId] -= chips;
}

// ======================================================
// PLAYER HELPERS
// ======================================================

function findPlayer(
  room: Room,
  id: string
) {
  return room.players.find(
    (player) =>
      player.id === id
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
    .map((id) =>
      findPlayer(
        room,
        id
      )
    )
    .filter(
      Boolean
    ) as Player[];
}

// ======================================================
// NEXT ROUND STARTER
// ======================================================

function determineNextStarter(
  room: Room
) {
  if (
    room.history.length === 0
  ) {
    return room.hostId;
  }

  const previous =
    room.history[
      room.history.length - 1
    ];

  const existingPlayers =
    room.players.filter(
      (player) =>
        previous.scores[
          player.id
        ] !== undefined
    );

  if (
    existingPlayers.length ===
    0
  ) {
    return room.hostId;
  }

  const highestScore =
    Math.max(
      ...existingPlayers.map(
        (player) =>
          previous.scores[
            player.id
          ]
      )
    );

  let tied =
    existingPlayers.filter(
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

  // Tie breaker:
  // Chip head-to-head
  // เฉพาะกลุ่มที่คะแนนเสมอกัน

  const chipScores =
    tied.map((player) => {
      let value = 0;

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

        value +=
          room.ledger[
            player.id
          ]?.[
            opponent.id
          ] || 0;
      }

      return {
        player,
        value,
      };
    });

  const highestChip =
    Math.max(
      ...chipScores.map(
        (item) =>
          item.value
      )
    );

  tied =
    chipScores
      .filter(
        (item) =>
          item.value ===
          highestChip
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

  // ยังเสมออีก
  // ใช้ Seat Order เดิม

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

    const isActive =
      game.activePlayerIds.includes(
        player.id
      );

    const tablePlayers =
      room.players
        .filter(
          (p) =>
            p.id !==
            player.id
        )
        .map((p) => ({
          id:
            p.id,

          name:
            p.name,

          totalChip:
            p.totalChip,

          activeInRound:
            game.activePlayerIds.includes(
              p.id
            ),

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
      }
    );
  }
}

// ======================================================
// ROUND SETTLEMENT
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
    const hand =
      game.hands[
        player.id
      ] || [];

    const initialTrip =
      game
        .initialTripPlayers
        .includes(
          player.id
        );

    scores[player.id] =
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
      "Settlement != 0:",
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

function startRound(
  room: Room
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

  const activeIds =
    room.players.map(
      (player) =>
        player.id
    );

  const starterId =
    room.history.length ===
    0
      ? room.hostId
      : determineNextStarter(
          room
        );

  const starterIndex =
    activeIds.indexOf(
      starterId
    );

  const orderedIds =
    starterIndex >= 0
      ? [
          ...activeIds.slice(
            starterIndex
          ),
          ...activeIds.slice(
            0,
            starterIndex
          ),
        ]
      : activeIds;

  const hands: Record<
    string,
    Card[]
  > = {};

  for (
    const id
    of orderedIds
  ) {
    hands[id] = [];
  }

  // แจกทีละใบ
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

      if (card) {
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

  room.status =
    "playing";

  room.game = {
    roundNumber:
      (room.game
        ?.roundNumber ||
        0) + 1,

    phase:
      "playing",

    activePlayerIds:
      orderedIds,

    starterId:
      orderedIds[0],

    deck,

    discardPile: [],

    hands,

    currentPlayerId:
      orderedIds[0],

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

  // ตองจากแจกแรก = 31
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

  if (firstDiscard) {
    room.game
      .discardPile
      .push(
        firstDiscard
      );
  }

  sendGameState(
    room
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

  const next =
    (index + 1) %
    ids.length;

  game.currentPlayerId =
    ids[next];

  game.hasDrawn =
    false;
}

function advanceFinalTurn(
  room: Room
) {
  const game =
    room.game;

  if (!game) {
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
// SOCKET
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

        const player:
          Player = {
          id:
            socket.id,

          name:
            data.name
              ?.trim() ||
            "Player",

          totalChip: 0,
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

          game: null,

          ledger: {},

          history: [],
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

    // --------------------------------------------------
    // JOIN ROOM
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

          totalChip: 0,
        };

        room.players.push(
          player
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

        // ถ้าเกมกำลังเล่น
        // ผู้เล่นใหม่จะไม่ได้ active
        // จนกว่าจะ Next Round

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
              "จั่วแล้ว",
          });

          return;
        }

        rebuildDeck(
          game
        );

        const card =
          game.deck.pop();

        if (!card) {
          callback({
            ok: false,
            message:
              "ไม่มีไพ่",
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
          });

          return;
        }

        const card =
          game
            .discardPile
            .pop();

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

        game
          .discardPile
          .push(
            discarded
          );

        game.hasDrawn =
          false;

        const score =
          calculateScore(
            hand
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

        // Knock Final Round
        // ต่อให้ได้ 31
        // ก็ต้องให้ทุกคนเล่นครบ

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
              "Knock ไม่ได้",
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
              "Knock ต้องกดก่อนจั่ว",
          });

          return;
        }

        const ids =
          game
            .activePlayerIds;

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
              (index +
                step) %
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
    // EMOJI
    // --------------------------------------------------

    socket.on(
      "emoji-reaction",
      (
        data: {
          code: string;
          emoji: string;
        }
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
          return;
        }

        const player =
          findPlayer(
            room,
            socket.id
          );

        if (!player) {
          return;
        }

        const allowed =
          [
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

        if (
          !allowed.includes(
            data.emoji
          )
        ) {
          return;
        }

        // ไม่มี cooldown
        // กดรัวได้

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
          }
        );
      }
    );

    // --------------------------------------------------
    // END GAME
    // --------------------------------------------------

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

        room.status =
          "ended";

        if (room.game) {
          room.game.currentPlayerId =
            null;
        }

        io.to(
          room.code
        ).emit(
          "game-ended"
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
            const game =
              room.game;

            game.activePlayerIds =
              game.activePlayerIds.filter(
                (id) =>
                  id !==
                  socket.id
              );

            delete game.hands[
              socket.id
            ];

            game.finalTurnsRemaining =
              game.finalTurnsRemaining.filter(
                (id) =>
                  id !==
                  socket.id
              );

            if (
              game.currentPlayerId ===
              socket.id
            ) {
              game.currentPlayerId =
                game
                  .activePlayerIds[0] ||
                null;

              game.hasDrawn =
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
              room.players[
                0
              ].id;
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
        "31 Scat Phase 3",

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
      "🃏 31 Scat Phase 3"
    );

    console.log(
      `🚀 http://localhost:${PORT}`
    );

    console.log("");
  }
);

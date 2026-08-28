import React, {
  useEffect,
  useMemo,
  useState,
} from "react";

import ReactDOM from "react-dom/client";

import {
  io,
} from "socket.io-client";

import "./styles.css";

// ======================================================
// TYPES
// ======================================================

type Suit =
  | "♠"
  | "♥"
  | "♦"
  | "♣";

type PlayerStatus =
  | "ACTIVE"
  | "RECONNECTING"
  | "LEFT";

type Card = {
  id: string;
  suit: Suit;
  rank: string;
  value: number;
};

type Player = {
  id: string;

  name: string;

  totalChip:
    number;

  status:
    PlayerStatus;

  disconnectedAt:
    number | null;
};

type Ledger =
  Record<
    string,
    Record<
      string,
      number
    >
  >;

type RoundResult = {
  roundNumber:
    number;

  starterId:
    string;

  reason:
    "knock" |
    "initial-trip";

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
    any[];
};

type Room = {
  code: string;

  hostId: string;

  multiplier:
    number;

  status:
    "waiting" |
    "playing" |
    "ended";

  reconnectGraceMs:
    number;

  players:
    Player[];

  ledger:
    Ledger;

  history:
    RoundResult[];
};

type TablePlayer = {
  id: string;

  name: string;

  totalChip:
    number;

  status:
    PlayerStatus;

  activeInRound:
    boolean;

  cardCount:
    number;
};

type GameState = {
  myPlayerId:
    string;

  roundNumber:
    number;

  phase:
    "playing" |
    "final-round" |
    "showdown";

  hand:
    Card[];

  activeInRound:
    boolean;

  tablePlayers:
    TablePlayer[];

  starterId:
    string;

  currentPlayerId:
    string | null;

  hasDrawn:
    boolean;

  knockedBy:
    string | null;

  finalTurnsRemaining:
    string[];

  deckCount:
    number;

  topDiscard:
    Card | null;

  result:
    RoundResult | null;

  emojiRemaining:
    number;
};

type Reaction = {
  id: string;

  playerId:
    string;

  name: string;

  emoji:
    string;

  seed:
    number;
};

// ======================================================
// SESSION
// ======================================================

const SESSION_KEY =
  "scat31-session-v42";

type SavedSession = {
  roomCode:
    string;

  playerId:
    string;

  playerToken:
    string;
};

function loadSession():
  SavedSession | null {
  try {
    const data =
      localStorage.getItem(
        SESSION_KEY
      );

    if (
      !data
    ) {
      return null;
    }

    return JSON.parse(
      data
    );
  } catch {
    return null;
  }
}

function saveSession(
  data: SavedSession
) {
  localStorage.setItem(
    SESSION_KEY,

    JSON.stringify(
      data
    )
  );
}

function clearSession() {
  localStorage.removeItem(
    SESSION_KEY
  );
}

// ======================================================
// SOCKET
// ======================================================

const socket =
  io(
    import.meta.env.DEV
      ? "http://localhost:3001"
      : undefined,

    {
      reconnection:
        true,

      reconnectionAttempts:
        Infinity,

      reconnectionDelay:
        500,

      reconnectionDelayMax:
        5000,

      timeout:
        20000,
    }
  );

// ======================================================
// APP
// ======================================================

function App() {

  const [
    connected,
    setConnected,
  ] =
    useState(
      socket.connected
    );

  const [
    restoring,
    setRestoring,
  ] =
    useState(
      Boolean(
        loadSession()
      )
    );

  const [
    myPlayerId,
    setMyPlayerId,
  ] =
    useState(
      loadSession()
        ?.playerId ||
        ""
    );

  const [
    name,
    setName,
  ] =
    useState("");

  const [
    roomCode,
    setRoomCode,
  ] =
    useState("");

  const [
    multiplier,
    setMultiplier,
  ] =
    useState(2);

  const [
    room,
    setRoom,
  ] =
    useState<
      Room | null
    >(null);

  const [
    game,
    setGame,
  ] =
    useState<
      GameState | null
    >(null);

  const [
    selectedCard,
    setSelectedCard,
  ] =
    useState<
      string | null
    >(null);

  const [
    error,
    setError,
  ] =
    useState("");

  const [
    showLedger,
    setShowLedger,
  ] =
    useState(false);

  const [
    reactions,
    setReactions,
  ] =
    useState<
      Reaction[]
    >([]);

  const [
    emojiRemaining,
    setEmojiRemaining,
  ] =
    useState(10);

  const [
    emojiLock,
    setEmojiLock,
  ] =
    useState(false);

  // ====================================================
  // RESUME
  // ====================================================

  function resumeSession() {
    const saved =
      loadSession();

    if (
      !saved
    ) {
      setRestoring(
        false
      );

      return;
    }

    socket.emit(
      "resume-session",

      {
        code:
          saved.roomCode,

        playerId:
          saved.playerId,

        playerToken:
          saved.playerToken,
      },

      (
        response:
          any
      ) => {
        setRestoring(
          false
        );

        if (
          !response?.ok
        ) {
          clearSession();

          setRoom(
            null
          );

          setGame(
            null
          );

          setMyPlayerId(
            ""
          );

          setError(
            response?.message ||
            "Session หมดอายุ"
          );

          return;
        }

        setMyPlayerId(
          response.playerId
        );

        setRoom(
          response.room
        );

        setError(
          ""
        );
      }
    );
  }

  // ====================================================
  // SOCKET EVENTS
  // ====================================================

  useEffect(
    () => {

      function onConnect() {
        setConnected(
          true
        );

        if (
          loadSession()
        ) {
          setRestoring(
            true
          );

          resumeSession();
        } else {
          setRestoring(
            false
          );
        }
      }

      function onDisconnect() {
        setConnected(
          false
        );
      }

      function onRoomUpdate(
        data: Room
      ) {
        setRoom(
          data
        );
      }

      function onGameState(
        data: GameState
      ) {
        setGame(
          data
        );

        setMyPlayerId(
          data.myPlayerId
        );

        setEmojiRemaining(
          data.emojiRemaining ??
          10
        );

        if (
          !data.hasDrawn
        ) {
          setSelectedCard(
            null
          );
        }
      }

      function onEmoji(
        reaction:
          Reaction
      ) {
        setReactions(
          (current) => [
            ...current,
            reaction,
          ]
        );

        setTimeout(
          () => {
            setReactions(
              (current) =>
                current.filter(
                  (item) =>
                    item.id !==
                    reaction.id
                )
            );
          },

          2300
        );
      }

      socket.on(
        "connect",
        onConnect
      );

      socket.on(
        "disconnect",
        onDisconnect
      );

      socket.on(
        "room-update",
        onRoomUpdate
      );

      socket.on(
        "game-state",
        onGameState
      );

      socket.on(
        "emoji-reaction",
        onEmoji
      );

      if (
        socket.connected
      ) {
        onConnect();
      }

      return () => {
        socket.off(
          "connect",
          onConnect
        );

        socket.off(
          "disconnect",
          onDisconnect
        );

        socket.off(
          "room-update",
          onRoomUpdate
        );

        socket.off(
          "game-state",
          onGameState
        );

        socket.off(
          "emoji-reaction",
          onEmoji
        );
      };
    },

    []
  );

  // ====================================================
  // HELPERS
  // ====================================================

  const isHost =
    room?.hostId ===
    myPlayerId;

  const myTurn =
    game
      ?.currentPlayerId ===
    myPlayerId;

  const myPlayer =
    room?.players.find(
      (player) =>
        player.id ===
        myPlayerId
    );

  function playerName(
    id: string
  ) {
    return (
      room?.players.find(
        (player) =>
          player.id ===
          id
      )?.name ||
      "Player"
    );
  }

  function callback(
    response:
      any
  ) {
    if (
      !response?.ok
    ) {
      setError(
        response?.message ||
        "เกิดข้อผิดพลาด"
      );
    } else {
      setError(
        ""
      );
    }
  }

  const previewScore =
    useMemo(
      () => {

        if (
          !game ||
          game.hand.length !==
          3
        ) {
          return "-";
        }

        const hand =
          game.hand;

        const trip =
          hand.every(
            (card) =>
              card.rank ===
              hand[0].rank
          );

        if (
          trip
        ) {
          return 30.5;
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
      },

      [game]
    );

  // ====================================================
  // ROOM
  // ====================================================

  function createRoom() {
    if (
      !name.trim()
    ) {
      setError(
        "กรุณาใส่ชื่อ"
      );

      return;
    }

    socket.emit(
      "create-room",

      {
        name:
          name.trim(),

        multiplier,
      },

      (
        response:
          any
      ) => {

        if (
          !response?.ok
        ) {
          setError(
            response?.message ||
            "สร้างห้องไม่ได้"
          );

          return;
        }

        saveSession({
          roomCode:
            response.room.code,

          playerId:
            response.playerId,

          playerToken:
            response.playerToken,
        });

        setMyPlayerId(
          response.playerId
        );

        setRoom(
          response.room
        );

        setError(
          ""
        );
      }
    );
  }

  function joinRoom() {
    if (
      !name.trim() ||
      !roomCode.trim()
    ) {
      setError(
        "กรุณาใส่ชื่อและ Room Code"
      );

      return;
    }

    socket.emit(
      "join-room",

      {
        name:
          name.trim(),

        code:
          roomCode
            .trim()
            .toUpperCase(),
      },

      (
        response:
          any
      ) => {

        if (
          !response?.ok
        ) {
          setError(
            response?.message ||
            "เข้าห้องไม่ได้"
          );

          return;
        }

        saveSession({
          roomCode:
            response.room.code,

          playerId:
            response.playerId,

          playerToken:
            response.playerToken,
        });

        setMyPlayerId(
          response.playerId
        );

        setRoom(
          response.room
        );

        setError(
          ""
        );
      }
    );
  }

  function startGame() {
    if (
      !room
    ) {
      return;
    }

    socket.emit(
      "start-game",

      {
        code:
          room.code,
      },

      callback
    );
  }

  function nextRound() {
    if (
      !room
    ) {
      return;
    }

    socket.emit(
      "next-round",

      {
        code:
          room.code,
      },

      callback
    );
  }

  // ====================================================
  // GAME
  // ====================================================

  function drawDeck() {
    if (
      !room
    ) {
      return;
    }

    socket.emit(
      "draw-deck",

      {
        code:
          room.code,
      },

      callback
    );
  }

  function drawDiscard() {
    if (
      !room
    ) {
      return;
    }

    socket.emit(
      "draw-discard",

      {
        code:
          room.code,
      },

      callback
    );
  }

  function discardCard() {
    if (
      !room ||
      !selectedCard
    ) {
      return;
    }

    socket.emit(
      "discard-card",

      {
        code:
          room.code,

        cardId:
          selectedCard,
      },

      (
        response:
          any
      ) => {

        callback(
          response
        );

        if (
          response?.ok
        ) {
          setSelectedCard(
            null
          );
        }
      }
    );
  }

  function knock() {
    if (
      !room
    ) {
      return;
    }

    socket.emit(
      "knock",

      {
        code:
          room.code,
      },

      callback
    );
  }

  // ====================================================
  // EMOJI
  // ====================================================

  function sendEmoji(
    emoji: string
  ) {
    if (
      !room ||
      emojiLock ||
      emojiRemaining <=
        0
    ) {
      return;
    }

    setEmojiLock(
      true
    );

    socket.emit(
      "emoji-reaction",

      {
        code:
          room.code,

        emoji,
      },

      (
        response:
          any
      ) => {

        if (
          response?.remaining !==
          undefined
        ) {
          setEmojiRemaining(
            response.remaining
          );
        }

        if (
          !response?.ok &&
          response?.message !==
          "กดเร็วเกินไป"
        ) {
          setError(
            response?.message ||
            ""
          );
        }
      }
    );

    setTimeout(
      () =>
        setEmojiLock(
          false
        ),

      400
    );
  }

  // ====================================================
  // LEAVE
  // ====================================================

  function leaveRoom() {
    if (
      !room
    ) {
      return;
    }

    if (
      !window.confirm(
        "ต้องการออกจากห้องหรือไม่?\n\nคะแนนและประวัติของคุณจะยังถูกเก็บไว้"
      )
    ) {
      return;
    }

    socket.emit(
      "leave-room",

      {
        code:
          room.code,
      },

      (
        response:
          any
      ) => {

        if (
          !response?.ok
        ) {
          callback(
            response
          );

          return;
        }

        clearSession();

        setRoom(
          null
        );

        setGame(
          null
        );

        setMyPlayerId(
          ""
        );

        setSelectedCard(
          null
        );

        setError(
          ""
        );
      }
    );
  }

  function endGame() {
    if (
      !room
    ) {
      return;
    }

    if (
      !window.confirm(
        "ต้องการจบเกมทั้งหมดหรือไม่?"
      )
    ) {
      return;
    }

    socket.emit(
      "end-game",

      {
        code:
          room.code,
      },

      callback
    );
  }

  function goHome() {
    clearSession();

    setRoom(
      null
    );

    setGame(
      null
    );

    setMyPlayerId(
      ""
    );
  }

  // ====================================================
  // CARD
  // ====================================================

  function CardView({
    card,

    selectable = false,
  }: {
    card:
      Card;

    selectable?:
      boolean;
  }) {

    const red =
      card.suit ===
        "♥" ||
      card.suit ===
        "♦";

    const className = [
      "playing-card",

      red
        ? "red-card"
        : "",

      selectable
        ? "selectable"
        : "",

      selectedCard ===
      card.id
        ? "selected-card"
        : "",
    ].join(" ");

    if (
      !selectable
    ) {
      return (
        <div
          className={
            className
          }
        >
          <div className="rank">
            {card.rank}
          </div>

          <div className="suit">
            {card.suit}
          </div>
        </div>
      );
    }

    return (
      <button
        className={
          className
        }

        onClick={() =>
          setSelectedCard(
            card.id
          )
        }
      >
        <div className="rank">
          {card.rank}
        </div>

        <div className="suit">
          {card.suit}
        </div>
      </button>
    );
  }

  // ====================================================
  // STATUS
  // ====================================================

  function StatusBadge({
    status,
  }: {
    status:
      PlayerStatus;
  }) {

    if (
      status ===
      "RECONNECTING"
    ) {
      return (
        <span className="reconnecting-badge">
          ↻ RECONNECTING
        </span>
      );
    }

    if (
      status ===
      "LEFT"
    ) {
      return (
        <span className="left-badge">
          LEFT
        </span>
      );
    }

    return null;
  }

  // ====================================================
  // EMOJI LAYER
  // ====================================================

  function EmojiLayer() {
    return (
      <div className="emoji-layer">
        {reactions.map(
          (
            reaction
          ) => {

            const lane =
              Math.floor(
                reaction.seed *
                  5
              );

            const left =
              18 +
              lane *
                38;

            const drift =
              20 +
              reaction.seed *
                90;

            const rotation =
              (
                reaction.seed -
                0.5
              ) *
              24;

            return (
              <div
                key={
                  reaction.id
                }

                className="emoji-pop-left"

                style={
                  {
                    "--emoji-left":
                      `${left}px`,

                    "--emoji-drift":
                      `${drift}px`,

                    "--emoji-rotation":
                      `${rotation}deg`,
                  } as
                    React.CSSProperties
                }
              >
                <div className="emoji-big">
                  {
                    reaction.emoji
                  }
                </div>

                <div className="emoji-name">
                  {
                    reaction.name
                  }
                </div>
              </div>
            );
          }
        )}
      </div>
    );
  }

  function EmojiBar() {

    const emojis = [
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

    return (
      <div className="emoji-section">

        <div className="emoji-counter">
          Emoji{" "}
          {emojiRemaining}
          /10
        </div>

        <div className="emoji-bar">
          {emojis.map(
            (emoji) => (
              <button
                key={
                  emoji
                }

                disabled={
                  emojiRemaining <=
                  0
                }

                onClick={() =>
                  sendEmoji(
                    emoji
                  )
                }
              >
                {emoji}
              </button>
            )
          )}
        </div>
      </div>
    );
  }

  // ====================================================
  // LEDGER
  // ====================================================

  function LedgerModal() {

    if (
      !room ||
      !showLedger
    ) {
      return null;
    }

    const mine =
      room.ledger[
        myPlayerId
      ] ||
      {};

    return (
      <div className="modal-bg">

        <div className="modal">

          <button
            className="modal-close"

            onClick={() =>
              setShowLedger(
                false
              )
            }
          >
            ✕
          </button>

          <h2>
            💰 CHIP SUMMARY
          </h2>

          <div className="my-total">
            <span>
              {
                myPlayer?.name
              }
            </span>

            <strong>
              {(
                myPlayer
                  ?.totalChip ||
                0
              ) > 0
                ? "+"
                : ""}

              {
                myPlayer
                  ?.totalChip ||
                0
              }
            </strong>
          </div>

          <h3>
            ยอดระหว่างคุณกับแต่ละคน
          </h3>

          {room.players
            .filter(
              (player) =>
                player.id !==
                myPlayerId
            )
            .map(
              (player) => {

                const value =
                  mine[
                    player.id
                  ] ||
                  0;

                return (
                  <div
                    className="ledger-row"

                    key={
                      player.id
                    }
                  >
                    <span>
                      {
                        player.name
                      }

                      {" "}

                      {player.status ===
                        "LEFT" && (
                        <span className="left-badge">
                          LEFT
                        </span>
                      )}
                    </span>

                    {value >
                    0 ? (
                      <strong className="positive">
                        +
                        {
                          value
                        }
                      </strong>
                    ) : value <
                      0 ? (
                      <strong className="negative">
                        {
                          value
                        }
                      </strong>
                    ) : (
                      <strong>
                        0
                      </strong>
                    )}
                  </div>
                );
              }
            )}

          <h3>
            ตารางคะแนนรวม
          </h3>

          {[...room.players]
            .sort(
              (a, b) =>
                b.totalChip -
                a.totalChip
            )
            .map(
              (
                player,
                index
              ) => (
                <div
                  className="total-row"

                  key={
                    player.id
                  }
                >
                  <span>
                    #
                    {
                      index +
                      1
                    }
                    {" "}
                    {
                      player.name
                    }

                    {" "}

                    {player.status ===
                      "LEFT" && (
                      <span className="left-badge">
                        LEFT
                      </span>
                    )}
                  </span>

                  <strong
                    className={
                      player.totalChip >
                      0
                        ? "positive"
                        : player.totalChip <
                          0
                        ? "negative"
                        : ""
                    }
                  >
                    {player.totalChip >
                    0
                      ? "+"
                      : ""}

                    {
                      player.totalChip
                    }
                  </strong>
                </div>
              )
            )}
        </div>
      </div>
    );
  }

  // ====================================================
  // CONNECTION OVERLAY
  // ====================================================

  function ConnectionOverlay() {

    if (
      connected &&
      !restoring
    ) {
      return null;
    }

    if (
      !loadSession()
    ) {
      return null;
    }

    return (
      <div className="connection-overlay">

        <div className="connection-box">

          <div className="reconnect-spinner">
            ↻
          </div>

          <h2>
            กำลังเชื่อมต่อกลับเข้าเกม
          </h2>

          <p>
            ไพ่ คะแนน และตาของคุณยังถูกเก็บไว้
          </p>

          <small>
            ระบบจะรอคุณสูงสุด 5 นาที
          </small>

        </div>
      </div>
    );
  }

  // ====================================================
  // RESTORING
  // ====================================================

  if (
    restoring &&
    !room
  ) {
    return (
      <div className="restore-page">

        <div className="connection-box">

          <div className="reconnect-spinner">
            ↻
          </div>

          <h2>
            กำลังกลับเข้าเกม...
          </h2>

          <p>
            กำลังโหลดห้องเดิม
          </p>

        </div>
      </div>
    );
  }

  // ====================================================
  // FINAL RESULT
  // ====================================================

  if (
    room?.status ===
    "ended"
  ) {

    const sorted =
      [...room.players].sort(
        (a, b) =>
          b.totalChip -
          a.totalChip
      );

    const pairRows: {
      from:
        string;

      to:
        string;

      amount:
        number;
    }[] = [];

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

        const value =
          room.ledger[
            a.id
          ]?.[
            b.id
          ] ||
          0;

        if (
          value > 0
        ) {
          pairRows.push({
            from:
              b.name,

            to:
              a.name,

            amount:
              value,
          });
        } else if (
          value < 0
        ) {
          pairRows.push({
            from:
              a.name,

            to:
              b.name,

            amount:
              Math.abs(
                value
              ),
          });
        }
      }
    }

    return (
      <div className="app">

        <header>

          <div>
            <div className="logo">
              🃏 31 SCAT
            </div>

            <div className="subtitle">
              FINAL RESULT
            </div>
          </div>

        </header>

        <main className="final-page">

          <h1>
            🏁 GAME OVER
          </h1>

          <p>
            เล่นทั้งหมด{" "}
            {
              room.history.length
            }{" "}
            รอบ
          </p>

          <section className="final-ranking">

            {sorted.map(
              (
                player,
                index
              ) => (
                <div
                  className="final-player"

                  key={
                    player.id
                  }
                >
                  <div className="rank-number">
                    #
                    {
                      index +
                      1
                    }
                  </div>

                  <div>
                    <strong>
                      {
                        player.name
                      }
                    </strong>

                    {" "}

                    <StatusBadge
                      status={
                        player.status
                      }
                    />
                  </div>

                  <b
                    className={
                      player.totalChip >
                      0
                        ? "positive"
                        : player.totalChip <
                          0
                        ? "negative"
                        : ""
                    }
                  >
                    {player.totalChip >
                    0
                      ? "+"
                      : ""}

                    {
                      player.totalChip
                    }{" "}
                    CHIP
                  </b>
                </div>
              )
            )}

          </section>

          <section className="final-settlement">

            <h2>
              ใครเสียให้ใครบ้าง
            </h2>

            {pairRows.length ===
            0 ? (
              <p>
                ไม่มียอดระหว่างผู้เล่น
              </p>
            ) : (
              pairRows.map(
                (
                  item,
                  index
                ) => (
                  <div
                    className="final-payment"

                    key={
                      index
                    }
                  >
                    <span>
                      {
                        item.from
                      }
                    </span>

                    <strong>
                      →
                    </strong>

                    <span>
                      {
                        item.to
                      }
                    </span>

                    <b>
                      {
                        item.amount
                      }{" "}
                      CHIP
                    </b>
                  </div>
                )
              )
            )}

          </section>

          <button
            className="primary home-button"

            onClick={
              goHome
            }
          >
            BACK TO HOME
          </button>

        </main>
      </div>
    );
  }

  // ====================================================
  // HOME
  // ====================================================

  if (
    !room
  ) {
    return (
      <div className="app">

        <header>

          <div>

            <div className="logo">
              🃏 31 SCAT
            </div>

            <div className="subtitle">
              Custom Rules v1.1
            </div>

          </div>

          <div className="connection">

            <span
              className={
                connected
                  ? "dot online"
                  : "dot"
              }
            />

            {connected
              ? "Server Online"
              : "Connecting..."}

          </div>

        </header>

        <main className="home">

          <section className="hero">

            <div className="card-decoration">
              ♠ ♥ ♦ ♣
            </div>

            <h1>
              31
              <span>
                {" "}
                SCAT
              </span>
            </h1>

            <p>
              สร้างห้อง แล้วส่ง Room Code ให้เพื่อน
            </p>

          </section>

          <section className="panel">

            <label>
              YOUR NAME
            </label>

            <input
              value={
                name
              }

              onChange={(
                event
              ) =>
                setName(
                  event.target.value
                )
              }

              placeholder="ชื่อผู้เล่น"
            />

            <div className="divider">
              CHIP MULTIPLIER
            </div>

            <div className="multipliers">

              {[
                1,
                2,
                5,
                10,
              ].map(
                (
                  value
                ) => (
                  <button
                    key={
                      value
                    }

                    className={
                      multiplier ===
                      value
                        ? "selected"
                        : ""
                    }

                    onClick={() =>
                      setMultiplier(
                        value
                      )
                    }
                  >
                    {value}×
                  </button>
                )
              )}

            </div>

            <button
              className="primary"

              onClick={
                createRoom
              }
            >
              CREATE ROOM
            </button>

            <div className="divider">
              OR JOIN
            </div>

            <input
              value={
                roomCode
              }

              maxLength={
                4
              }

              onChange={(
                event
              ) =>
                setRoomCode(
                  event.target.value.toUpperCase()
                )
              }

              placeholder="ROOM CODE"
            />

            <button
              className="secondary"

              onClick={
                joinRoom
              }
            >
              JOIN ROOM
            </button>

            {error && (
              <div className="error">
                {
                  error
                }
              </div>
            )}

          </section>

        </main>
      </div>
    );
  }

  // ====================================================
  // WAITING ROOM
  // ====================================================

  if (
    room.status ===
      "waiting" ||
    !game
  ) {

    const liveCount =
      room.players.filter(
        (player) =>
          player.status !==
          "LEFT"
      ).length;

    return (
      <>
        <ConnectionOverlay />

        <LedgerModal />

        <div className="app">

          <header>

            <div>

              <div className="logo">
                🃏 31 SCAT
              </div>

              <div className="subtitle">
                ROOM{" "}
                {
                  room.code
                }
              </div>

            </div>

            <div className="header-buttons">

              <button
                className="summary-button"

                onClick={() =>
                  setShowLedger(
                    true
                  )
                }
              >
                💰 CHIP
              </button>

              <button
                className="leave-button"

                onClick={
                  leaveRoom
                }
              >
                🚪 LEAVE
              </button>

            </div>

          </header>

          <main className="room-page">

            <div className="room-info">

              ROOM CODE

              <strong>
                {
                  room.code
                }
              </strong>

              <span>
                CHIP{" "}
                {
                  room.multiplier
                }
                ×
              </span>

            </div>

            <section className="game-table">

              <div className="table-title">
                WAITING FOR PLAYERS
              </div>

              <div className="players">

                {room.players.map(
                  (player) => (
                    <div
                      className={[
                        "player",

                        player.status ===
                        "LEFT"
                          ? "left-player"
                          : "",

                        player.status ===
                        "RECONNECTING"
                          ? "disconnected-player"
                          : "",
                      ].join(" ")}

                      key={
                        player.id
                      }
                    >

                      <div className="avatar">
                        {player.name
                          .charAt(
                            0
                          )
                          .toUpperCase()}
                      </div>

                      <strong>
                        {
                          player.name
                        }
                      </strong>

                      {player.id ===
                        room.hostId && (
                        <span className="host">
                          HOST
                        </span>
                      )}

                      <StatusBadge
                        status={
                          player.status
                        }
                      />

                      <div className="chips">
                        {
                          player.totalChip
                        }{" "}
                        CHIP
                      </div>

                    </div>
                  )
                )}

              </div>

              <div className="player-count">
                {liveCount} Players
              </div>

              {isHost ? (
                <button
                  className="start-button"

                  disabled={
                    liveCount <
                    2
                  }

                  onClick={
                    startGame
                  }
                >
                  START GAME
                </button>
              ) : (
                <div className="waiting">
                  รอ Host เริ่มเกม
                </div>
              )}

              {error && (
                <div className="error">
                  {
                    error
                  }
                </div>
              )}

            </section>

          </main>

        </div>
      </>
    );
  }

  // ====================================================
  // SHOWDOWN
  // ====================================================

  if (
    game.phase ===
      "showdown" &&
    game.result
  ) {
    return (
      <>
        <ConnectionOverlay />

        <EmojiLayer />

        <LedgerModal />

        <div className="app">

          <header>

            <div>

              <div className="logo">
                🃏 31 SCAT
              </div>

              <div className="subtitle">
                ROUND{" "}
                {
                  game.roundNumber
                }
              </div>

            </div>

            <div className="header-buttons">

              <button
                className="summary-button"

                onClick={() =>
                  setShowLedger(
                    true
                  )
                }
              >
                💰 CHIP
              </button>

              <button
                className="leave-button"

                onClick={
                  leaveRoom
                }
              >
                🚪 LEAVE
              </button>

              {isHost && (
                <button
                  className="end-button"

                  onClick={
                    endGame
                  }
                >
                  END GAME
                </button>
              )}

            </div>

          </header>

          <main className="result-page">

            <h1>
              SHOWDOWN
            </h1>

            <div className="result-grid">

              {room.players.map(
                (
                  player
                ) => {

                  const score =
                    game.result!
                      .scores[
                      player.id
                    ];

                  if (
                    score ===
                    undefined
                  ) {
                    return (
                      <div
                        className="result-player"

                        key={
                          player.id
                        }
                      >

                        <div className="avatar">
                          {player.name
                            .charAt(
                              0
                            )
                            .toUpperCase()}
                        </div>

                        <h3>
                          {
                            player.name
                          }
                        </h3>

                        <StatusBadge
                          status={
                            player.status
                          }
                        />

                        {player.status !==
                          "LEFT" && (
                          <>
                            <div className="waiting-next">
                              WAITING NEXT ROUND
                            </div>

                            <small>
                              ไม่คิด Chip รอบนี้
                            </small>
                          </>
                        )}

                      </div>
                    );
                  }

                  const net =
                    game.result!
                      .roundNet[
                      player.id
                    ] ||
                    0;

                  return (
                    <div
                      className="result-player"

                      key={
                        player.id
                      }
                    >

                      <div className="avatar">
                        {player.name
                          .charAt(
                            0
                          )
                          .toUpperCase()}
                      </div>

                      <h3>
                        {
                          player.name
                        }
                      </h3>

                      <StatusBadge
                        status={
                          player.status
                        }
                      />

                      <div className="big-score">
                        {
                          score
                        }
                      </div>

                      <div
                        className={
                          net >
                          0
                            ? "positive"
                            : net <
                              0
                            ? "negative"
                            : ""
                        }
                      >
                        {net >
                        0
                          ? "+"
                          : ""}

                        {
                          net
                        }{" "}
                        CHIP
                      </div>

                      <small>
                        TOTAL{" "}
                        {
                          player.totalChip
                        }
                      </small>

                    </div>
                  );
                }
              )}

            </div>

            <EmojiBar />

            {isHost ? (
              <button
                className="next-round"

                onClick={
                  nextRound
                }
              >
                NEXT ROUND
              </button>
            ) : (
              <div className="waiting">
                รอ Host เริ่มรอบต่อไป
              </div>
            )}

            {error && (
              <div className="error">
                {
                  error
                }
              </div>
            )}

          </main>

        </div>
      </>
    );
  }

  // ====================================================
  // PLAY GAME
  // ====================================================

  return (
    <>
      <ConnectionOverlay />

      <EmojiLayer />

      <LedgerModal />

      <div className="app">

        <header>

          <div>

            <div className="logo">
              🃏 31 SCAT
            </div>

            <div className="subtitle">
              ROOM{" "}
              {
                room.code
              }
              {" · "}
              ROUND{" "}
              {
                game.roundNumber
              }
            </div>

          </div>

          <div className="header-buttons">

            <button
              className="summary-button"

              onClick={() =>
                setShowLedger(
                  true
                )
              }
            >
              💰 CHIP
            </button>

            <button
              className="leave-button"

              onClick={
                leaveRoom
              }
            >
              🚪 LEAVE
            </button>

            {isHost && (
              <button
                className="end-button"

                onClick={
                  endGame
                }
              >
                END GAME
              </button>
            )}

          </div>

        </header>

        <main className="game-page">

          {game.phase ===
  "final-round" && (
  <div className="final-banner">
    ⚠️ FINAL ROUND ⚠️
    <br />

    <span>
      {playerName(
        game.knockedBy || ""
      )}{" "}
      KNOCKED
    </span>
  </div>
)}
          {!game.activeInRound && (
            <div className="join-midround-banner">
              👀 คุณเข้ามาระหว่างรอบ — รอเล่นในรอบถัดไป
            </div>
          )}

          <section className="real-table">

            <div className="starter-display">

              STARTER:{" "}

              <strong>
                {playerName(
                  game.starterId
                )}
              </strong>

            </div>

            <div className="opponents">

              {game.tablePlayers.map(
                (
                  player
                ) => (
                  <div
                    className={[
                      "opponent",

                      game.currentPlayerId ===
                      player.id
                        ? "current-player"
                        : "",

                      !player.activeInRound
                        ? "waiting-player"
                        : "",

                      player.status ===
                      "RECONNECTING"
                        ? "disconnected-player"
                        : "",

                      player.status ===
                      "LEFT"
                        ? "left-player"
                        : "",
                    ].join(" ")}

                    key={
                      player.id
                    }
                  >

                    <strong>
                      {
                        player.name
                      }
                    </strong>

                    <StatusBadge
                      status={
                        player.status
                      }
                    />

                    {player.status ===
                    "LEFT" ? (
                      <div className="waiting-next">
                        LEFT
                      </div>
                    ) : !player.activeInRound ? (
                      <div className="waiting-next">
                        NEXT ROUND
                      </div>
                    ) : (
                      <div className="card-backs">

                        {Array.from({
                          length:
                            player.cardCount,
                        }).map(
                          (
                            _,
                            index
                          ) => (
                            <div
                              className="card-back"

                              key={
                                index
                              }
                            >
                              🂠
                            </div>
                          )
                        )}

                      </div>
                    )}

                    <small>
                      {
                        player.totalChip
                      }{" "}
                      CHIP
                    </small>

                  </div>
                )
              )}

            </div>

            <div className="table-center">

              <button
                className="deck-stack"

                disabled={
                  !game.activeInRound ||
                  !myTurn ||
                  game.hasDrawn ||
                  !connected
                }

                onClick={
                  drawDeck
                }
              >

                <div>
                  🂠
                </div>

                <small>
                  DECK
                </small>

                <b>
                  {
                    game.deckCount
                  }
                </b>

              </button>

              <button
                className="discard-stack"

                disabled={
                  !game.activeInRound ||
                  !myTurn ||
                  game.hasDrawn ||
                  !game.topDiscard ||
                  !connected
                }

                onClick={
                  drawDiscard
                }
              >

                {game.topDiscard ? (
                  <CardView
                    card={
                      game.topDiscard
                    }
                  />
                ) : (
                  <div>
                    EMPTY
                  </div>
                )}

                <small>
                  DISCARD
                </small>

              </button>

            </div>

            {game.activeInRound ? (

              <div
                className={[
                  "my-area",

                  myTurn
                    ? "my-turn"
                    : "",
                ].join(" ")}
              >

                <div className="turn-label">

                  {myTurn
                    ? "YOUR TURN"
                    : `TURN: ${playerName(
                        game.currentPlayerId ||
                          ""
                      )}`}

                </div>

                <div className="my-hand">

                  {game.hand.map(
                    (
                      card
                    ) => (
                      <CardView
                        key={
                          card.id
                        }

                        card={
                          card
                        }

                        selectable={
                          myTurn &&
                          game.hasDrawn &&
                          connected
                        }
                      />
                    )
                  )}

                </div>

                <div className="score-preview">
                  SCORE:{" "}
                  {
                    previewScore
                  }
                </div>

                <div className="actions">

                  {myTurn &&
                    !game.hasDrawn && (
                      <>

                        <button
                          className="action draw"

                          disabled={
                            !connected
                          }

                          onClick={
                            drawDeck
                          }
                        >
                          DRAW DECK
                        </button>

                        <button
                          className="action draw"

                          disabled={
                            !game.topDiscard ||
                            !connected
                          }

                          onClick={
                            drawDiscard
                          }
                        >
                          DRAW DISCARD
                        </button>

                        {game.phase ===
                          "playing" && (
                          <button
                            className="action knock"

                            disabled={
                              !connected
                            }

                            onClick={
                              knock
                            }
                          >
                            KNOCK
                          </button>
                        )}

                      </>
                    )}

                  {myTurn &&
                    game.hasDrawn && (

                      <button
                        className="action discard"

                        disabled={
                          !selectedCard ||
                          !connected
                        }

                        onClick={
                          discardCard
                        }
                      >
                        DISCARD SELECTED
                      </button>

                    )}

                </div>

                {!myTurn && (
                  <div className="waiting-turn">
                    รอ{" "}
                    {playerName(
                      game.currentPlayerId ||
                        ""
                    )}{" "}
                    เล่น...
                  </div>
                )}

              </div>

            ) : (

              <div className="spectator-box">
                WAITING NEXT ROUND
              </div>

            )}

            <EmojiBar />

          </section>

          {error && (
            <div className="error">
              {
                error
              }
            </div>
          )}

        </main>

      </div>
    </>
  );
}

ReactDOM
  .createRoot(
    document.getElementById(
      "root"
    )!
  )
  .render(
    <App />
  );

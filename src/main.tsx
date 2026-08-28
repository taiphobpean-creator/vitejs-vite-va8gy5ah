import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import ReactDOM from "react-dom/client";

import { io } from "socket.io-client";

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

  totalChip: number;

  status:
    PlayerStatus;

  disconnectedAt:
    number | null;
};

type Ledger = Record<
  string,
  Record<string, number>
>;

type Settlement = {
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
    Settlement[];

  finalHands:
    Record<
      string,
      Card[]
    >;

  discardHistoryByPlayer:
    Record<
      string,
      Card[]
    >;
};

type ChatMessage = {
  id: string;

  playerId: string;

  name: string;

  message: string;

  createdAt: number;
};

type Room = {
  code: string;

  hostId: string;

  multiplier: number;

  status:
    | "waiting"
    | "playing"
    | "ended";

  reconnectGraceMs:
    number;

  players:
    Player[];

  ledger:
    Ledger;

  history:
    RoundResult[];

  chatMessages:
    ChatMessage[];
};

type TablePlayer = {
  id: string;

  name: string;

  totalChip: number;

  status:
    PlayerStatus;

  activeInRound:
    boolean;

  cardCount: number;
};

type GameState = {
  myPlayerId: string;

  roundNumber: number;

  phase:
    | "playing"
    | "final-round"
    | "showdown";

  hand: Card[];

  activeInRound:
    boolean;

  tablePlayers:
    TablePlayer[];

  starterId: string;

  currentPlayerId:
    string | null;

  hasDrawn: boolean;

  knockedBy:
    string | null;

  finalTurnsRemaining:
    string[];

  deckCount: number;

  topDiscard:
    Card | null;

  result:
    RoundResult | null;

  discardHistoryByPlayer:
    Record<
      string,
      Card[]
    >;

  emojiRemaining:
    number;
};

type Reaction = {
  id: string;

  playerId: string;

  name: string;

  emoji: string;

  seed: number;
};

// ======================================================
// SESSION
// ======================================================

const SESSION_KEY =
  "scat31-session-v44";

type SavedSession = {
  roomCode: string;

  playerId: string;

  playerToken: string;
};

function loadSession():
  SavedSession | null {
  try {
    const value =
      localStorage.getItem(
        SESSION_KEY
      );

    if (!value) {
      return null;
    }

    return JSON.parse(
      value
    );
  } catch {
    return null;
  }
}

function saveSession(
  session:
    SavedSession
) {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify(
      session
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

const socket = io(
  import.meta.env.DEV
    ? "http://localhost:3001"
    : undefined,
  {
    reconnection: true,

    reconnectionAttempts:
      Infinity,

    reconnectionDelay:
      500,

    reconnectionDelayMax:
      5000,

    timeout: 20000,
  }
);

// ======================================================
// APP
// ======================================================

function App() {
  const [
    connected,
    setConnected,
  ] = useState(
    socket.connected
  );

  const [
    restoring,
    setRestoring,
  ] = useState(
    Boolean(
      loadSession()
    )
  );

  const [
    myPlayerId,
    setMyPlayerId,
  ] = useState(
    loadSession()
      ?.playerId || ""
  );

  const [
    name,
    setName,
  ] = useState("");

  const [
    roomCode,
    setRoomCode,
  ] = useState("");

  const [
    multiplier,
    setMultiplier,
  ] = useState(2);

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
  ] = useState<
    string | null
  >(null);

  const [
    error,
    setError,
  ] = useState("");

  const [
    showLedger,
    setShowLedger,
  ] = useState(false);

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
  ] = useState(10);

  const [
    emojiLock,
    setEmojiLock,
  ] = useState(false);

  const [
    chatMessages,
    setChatMessages,
  ] =
    useState<
      ChatMessage[]
    >([]);

  const [
    chatText,
    setChatText,
  ] = useState("");

  const chatEndRef =
    useRef<
      HTMLDivElement | null
    >(null);

  // ====================================================
  // RESUME SESSION
  // ====================================================

  function resumeSession() {
    const saved =
      loadSession();

    if (!saved) {
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

          setRoom(null);

          setGame(null);

          setMyPlayerId("");

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

        setChatMessages(
          response.room
            ?.chatMessages ||
            []
        );

        setError("");
      }
    );
  }

  // ====================================================
  // SOCKET EVENTS
  // ====================================================

  useEffect(() => {
    function onConnect() {
      setConnected(true);

      if (
        loadSession()
      ) {
        setRestoring(true);

        resumeSession();
      } else {
        setRestoring(false);
      }
    }

    function onDisconnect() {
      setConnected(false);
    }

    function onRoomUpdate(
      data: Room
    ) {
      setRoom(data);

      setChatMessages(
        data.chatMessages ||
          []
      );
    }

    function onGameState(
      data:
        GameState
    ) {
      setGame(data);

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

      window.setTimeout(
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

    function onChat(
      message:
        ChatMessage
    ) {
      setChatMessages(
        (current) => {
          if (
            current.some(
              (item) =>
                item.id ===
                message.id
            )
          ) {
            return current;
          }

          return [
            ...current,
            message,
          ].slice(-50);
        }
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

    socket.on(
      "chat-message",
      onChat
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

      socket.off(
        "chat-message",
        onChat
      );
    };
  }, []);

  useEffect(
    () => {
      chatEndRef.current
        ?.scrollIntoView({
          behavior:
            "smooth",
        });
    },
    [chatMessages]
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
          player.id === id
      )?.name ||
      "Player"
    );
  }

  function seatNumber(
    playerId: string
  ) {
    if (!room) {
      return "-";
    }

    const active =
      room.players.filter(
        (player) =>
          player.status !==
          "LEFT"
      );

    const index =
      active.findIndex(
        (player) =>
          player.id ===
          playerId
      );

    return index >= 0
      ? index + 1
      : "-";
  }

  function handleResponse(
    response: any
  ) {
    if (
      !response?.ok
    ) {
      setError(
        response?.message ||
          "เกิดข้อผิดพลาด"
      );
    } else {
      setError("");
    }
  }

  const previewScore =
    useMemo(() => {
      if (
        !game ||
        game.hand.length !==
          3
      ) {
        return "-";
      }

      const hand =
        game.hand;

      if (
        hand.every(
          (card) =>
            card.rank ===
            hand[0].rank
        )
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
        ] += card.value;
      }

      return Math.max(
        ...Object.values(
          totals
        )
      );
    }, [game]);

  // ====================================================
  // ROOM ACTIONS
  // ====================================================

  function createRoom() {
    if (!name.trim()) {
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

        setChatMessages(
          response.room
            .chatMessages ||
            []
        );

        setError("");
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

        setChatMessages(
          response.room
            .chatMessages ||
            []
        );

        setError("");
      }
    );
  }

  function startGame() {
    if (!room) return;

    socket.emit(
      "start-game",
      {
        code: room.code,
      },
      handleResponse
    );
  }

  function nextRound() {
    if (!room) return;

    socket.emit(
      "next-round",
      {
        code: room.code,
      },
      handleResponse
    );
  }

  function shuffleSeats() {
    if (!room) return;

    socket.emit(
      "shuffle-seats",
      {
        code: room.code,
      },
      (
        response:
          any
      ) => {
        handleResponse(
          response
        );
      }
    );
  }

  // ====================================================
  // GAME
  // ====================================================

  function drawDeck() {
    if (!room) return;

    socket.emit(
      "draw-deck",
      {
        code: room.code,
      },
      handleResponse
    );
  }

  function drawDiscard() {
    if (!room) return;

    socket.emit(
      "draw-discard",
      {
        code: room.code,
      },
      handleResponse
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
        handleResponse(
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
    if (!room) return;

    socket.emit(
      "knock",
      {
        code: room.code,
      },
      handleResponse
    );
  }

  // ====================================================
  // CHAT
  // ====================================================

  function sendChat() {
    if (
      !room ||
      !chatText.trim()
    ) {
      return;
    }

    const text =
      chatText
        .trim()
        .slice(
          0,
          200
        );

    socket.emit(
      "send-chat",
      {
        code: room.code,

        message: text,
      },
      (
        response:
          any
      ) => {
        if (
          response?.ok
        ) {
          setChatText("");
        } else {
          setError(
            response?.message ||
              "ส่งข้อความไม่ได้"
          );
        }
      }
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
      emojiRemaining <= 0
    ) {
      return;
    }

    setEmojiLock(true);

    socket.emit(
      "emoji-reaction",
      {
        code: room.code,

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

    window.setTimeout(
      () =>
        setEmojiLock(
          false
        ),
      400
    );
  }

  // ====================================================
  // LEAVE / END
  // ====================================================

  function leaveRoom() {
    if (!room) return;

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
        code: room.code,
      },
      (
        response:
          any
      ) => {
        if (
          !response?.ok
        ) {
          handleResponse(
            response
          );

          return;
        }

        clearSession();

        setRoom(null);

        setGame(null);

        setMyPlayerId("");

        setSelectedCard(
          null
        );

        setChatMessages([]);

        setError("");
      }
    );
  }

  function endGame() {
    if (!room) return;

    if (
      !window.confirm(
        "ต้องการจบเกมทั้งหมดและสรุปยอดหรือไม่?"
      )
    ) {
      return;
    }

    socket.emit(
      "end-game",
      {
        code: room.code,
      },
      handleResponse
    );
  }

  function goHome() {
    clearSession();

    setRoom(null);

    setGame(null);

    setMyPlayerId("");

    setChatMessages([]);
  }

  // ====================================================
  // CARD
  // ====================================================

  function CardView({
    card,
    selectable = false,
  }: {
    card: Card;

    selectable?: boolean;
  }) {
    const red =
      card.suit === "♥" ||
      card.suit === "♦";

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

    if (!selectable) {
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

  function MiniCard({
    card,
  }: {
    card: Card;
  }) {
    const red =
      card.suit === "♥" ||
      card.suit === "♦";

    return (
      <div
        className={[
          "mini-card",
          red
            ? "mini-card-red"
            : "",
        ].join(" ")}
      >
        <span>
          {card.rank}
        </span>

        <b>
          {card.suit}
        </b>
      </div>
    );
  }

  function DiscardHistory({
    playerId,
    showdown = false,
  }: {
    playerId: string;

    showdown?: boolean;
  }) {
    let cards: Card[] =
      [];

    if (
      showdown &&
      game?.result
    ) {
      cards =
        game.result
          .discardHistoryByPlayer?.[
          playerId
        ] || [];
    } else {
      cards =
        game
          ?.discardHistoryByPlayer?.[
          playerId
        ] || [];
    }

    return (
      <div className="discard-history">
        <div className="discard-history-title">
          LAST DISCARD
        </div>

        <div className="mini-card-row">
          {cards.length ===
          0 ? (
            <span className="no-discard">
              —
            </span>
          ) : (
            cards
              .slice(-5)
              .map(
                (
                  card,
                  index
                ) => (
                  <MiniCard
                    key={`${card.id}-${index}`}
                    card={
                      card
                    }
                  />
                )
              )
          )}
        </div>
      </div>
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
      status === "LEFT"
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
  // EMOJI UI
  // ====================================================

  function EmojiLayer() {
    return (
      <div className="emoji-layer">
        {reactions.map(
          (reaction) => {
            const lane =
              Math.floor(
                reaction.seed *
                  5
              );

            const left =
              18 +
              lane * 38;

            const drift =
              20 +
              reaction.seed *
                90;

            const rotation =
              (
                reaction.seed -
                0.5
              ) * 24;

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
          EMOJI{" "}
          {emojiRemaining}/10
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
  // ROOM CHAT
  // ====================================================

  function RoomChat() {
    if (!room) {
      return null;
    }

    return (
      <aside className="chat-panel">
        <div className="chat-header">
          <div>
            💬 ROOM CHAT
          </div>

          <small>
            {chatMessages.length}/50
          </small>
        </div>

        <div className="chat-messages">
          {chatMessages.length ===
          0 && (
            <div className="chat-empty">
              ยังไม่มีข้อความ
            </div>
          )}

          {chatMessages.map(
            (message) => (
              <div
                className={[
                  "chat-message",
                  message.playerId ===
                  myPlayerId
                    ? "my-chat-message"
                    : "",
                ].join(" ")}
                key={
                  message.id
                }
              >
                <div className="chat-message-top">
                  <strong>
                    {
                      message.name
                    }
                  </strong>

                  <span>
                    {new Date(
                      message.createdAt
                    ).toLocaleTimeString(
                      "th-TH",
                      {
                        hour:
                          "2-digit",
                        minute:
                          "2-digit",
                      }
                    )}
                  </span>
                </div>

                <p>
                  {
                    message.message
                  }
                </p>
              </div>
            )
          )}

          <div
            ref={
              chatEndRef
            }
          />
        </div>

        <div className="chat-input-row">
          <input
            value={
              chatText
            }
            maxLength={
              200
            }
            placeholder="พิมพ์ข้อความ..."
            onChange={(
              event
            ) =>
              setChatText(
                event.target
                  .value
              )
            }
            onKeyDown={(
              event
            ) => {
              if (
                event.key ===
                  "Enter" &&
                !event.shiftKey
              ) {
                event.preventDefault();

                sendChat();
              }
            }}
          />

          <button
            disabled={
              !chatText.trim() ||
              !connected
            }
            onClick={
              sendChat
            }
          >
            SEND
          </button>
        </div>

        <div className="chat-count">
          {chatText.length}/200
        </div>
      </aside>
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
      ] || {};

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
                  ] || 0;

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

                    <strong
                      className={
                        value > 0
                          ? "positive"
                          : value < 0
                          ? "negative"
                          : ""
                      }
                    >
                      {value > 0
                        ? "+"
                        : ""}

                      {value}
                    </strong>
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
                      index + 1
                    }{" "}
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
  // RECONNECT OVERLAY
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
  // RESTORE
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
  // GAME ENDED
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
      from: string;
      to: string;
      amount: number;
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
          ] || 0;

        if (value > 0) {
          pairRows.push({
            from: b.name,
            to: a.name,
            amount: value,
          });
        } else if (
          value < 0
        ) {
          pairRows.push({
            from: a.name,
            to: b.name,
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
                      index + 1
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

  if (!room) {
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
              value={name}
              onChange={(
                event
              ) =>
                setName(
                  event.target
                    .value
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
                (value) => (
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
              maxLength={4}
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
                {error}
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
    const players =
      room.players.filter(
        (player) =>
          player.status !==
          "LEFT"
      );

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
                {room.code}
              </div>
            </div>

            <div className="header-buttons">
              {isHost && (
                <button
                  className="shuffle-button"
                  onClick={
                    shuffleSeats
                  }
                >
                  🔀 SHUFFLE
                </button>
              )}

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
                {room.code}
              </strong>

              <span>
                CHIP{" "}
                {
                  room.multiplier
                }
                ×
              </span>
            </div>

            <div className="waiting-layout">
              <section className="game-table">
                <div className="table-title">
                  WAITING FOR PLAYERS
                </div>

                <div className="players">
                  {players.map(
                    (
                      player,
                      index
                    ) => (
                      <div
                        className={[
                          "player",

                          player.status ===
                          "RECONNECTING"
                            ? "disconnected-player"
                            : "",
                        ].join(" ")}
                        key={
                          player.id
                        }
                      >
                        <div className="seat-badge">
                          SEAT{" "}
                          {
                            index + 1
                          }
                        </div>

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
                  {
                    players.length
                  }{" "}
                  Players
                </div>

                {isHost ? (
                  <>
                    <button
                      className="shuffle-seats-big"
                      onClick={
                        shuffleSeats
                      }
                    >
                      🔀 SHUFFLE SEATS
                    </button>

                    <button
                      className="start-button"
                      disabled={
                        players.length <
                        2
                      }
                      onClick={
                        startGame
                      }
                    >
                      START GAME
                    </button>
                  </>
                ) : (
                  <div className="waiting">
                    รอ Host เริ่มเกม
                  </div>
                )}

                {error && (
                  <div className="error">
                    {error}
                  </div>
                )}
              </section>

              <RoomChat />
            </div>
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
              {isHost && (
                <button
                  className="shuffle-button"
                  onClick={
                    shuffleSeats
                  }
                >
                  🔀 SHUFFLE
                </button>
              )}

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

            <div className="showdown-layout">
              <div>
                <div className="result-grid">
                  {room.players.map(
                    (player) => {
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
                            className="result-player spectator-result"
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
                        ] || 0;

                      const hand =
                        game.result!
                          .finalHands?.[
                          player.id
                        ] || [];

                      return (
                        <div
                          className="result-player"
                          key={
                            player.id
                          }
                        >
                          <div className="showdown-player-head">
                            <div className="avatar">
                              {player.name
                                .charAt(
                                  0
                                )
                                .toUpperCase()}
                            </div>

                            <div>
                              <h3>
                                {
                                  player.name
                                }
                              </h3>

                              <div className="showdown-seat">
                                SEAT{" "}
                                {seatNumber(
                                  player.id
                                )}
                              </div>
                            </div>
                          </div>

                          <StatusBadge
                            status={
                              player.status
                            }
                          />

                          <div className="showdown-hand">
                            {hand.map(
                              (card) => (
                                <CardView
                                  key={
                                    card.id
                                  }
                                  card={
                                    card
                                  }
                                />
                              )
                            )}
                          </div>

                          <div className="score-label">
                            SCORE
                          </div>

                          <div className="big-score">
                            {score}
                          </div>

                          <div
                            className={[
                              "result-chip",

                              net > 0
                                ? "positive"
                                : net < 0
                                ? "negative"
                                : "",
                            ].join(" ")}
                          >
                            {net > 0
                              ? "+"
                              : ""}

                            {net} CHIP
                          </div>

                          <small>
                            TOTAL{" "}
                            {
                              player.totalChip
                            }
                          </small>

                          <DiscardHistory
                            playerId={
                              player.id
                            }
                            showdown
                          />
                        </div>
                      );
                    }
                  )}
                </div>

                <EmojiBar />

                {isHost && (
                  <div className="showdown-host-actions">
                    <button
                      className="shuffle-seats-big"
                      onClick={
                        shuffleSeats
                      }
                    >
                      🔀 SHUFFLE SEATS
                    </button>

                    <button
                      className="next-round"
                      onClick={
                        nextRound
                      }
                    >
                      NEXT ROUND
                    </button>
                  </div>
                )}

                {!isHost && (
                  <div className="waiting">
                    รอ Host เริ่มรอบต่อไป
                  </div>
                )}

                {error && (
                  <div className="error">
                    {error}
                  </div>
                )}
              </div>

              <RoomChat />
            </div>
          </main>
        </div>
      </>
    );
  }

  // ====================================================
  // GAME
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
              {room.code}
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
              <div className="final-warning">
                ⚠️ FINAL ROUND ⚠️
              </div>

              <span>
                {playerName(
                  game.knockedBy ||
                    ""
                )}{" "}
                KNOCKED
              </span>
            </div>
          )}

          {!game.activeInRound && (
            <div className="join-midround-banner">
              👀 คุณเข้ามาระหว่างรอบ — WAITING NEXT ROUND
            </div>
          )}

          <div className="game-layout">
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
                  (player) => (
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
                      ].join(" ")}
                      key={
                        player.id
                      }
                    >
                      <div className="seat-badge">
                        SEAT{" "}
                        {seatNumber(
                          player.id
                        )}
                      </div>

                      <strong className="opponent-name">
                        {
                          player.name
                        }
                      </strong>

                      <StatusBadge
                        status={
                          player.status
                        }
                      />

                      {!player.activeInRound ? (
                        <div className="waiting-next">
                          WAITING NEXT ROUND
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

                      {player.activeInRound && (
                        <DiscardHistory
                          playerId={
                            player.id
                          }
                        />
                      )}

                      <small className="player-chip-small">
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
                    <div className="empty-discard">
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
                  <div className="my-player-info">
                    <span>
                      {
                        myPlayer?.name
                      }
                    </span>

                    <span>
                      SEAT{" "}
                      {seatNumber(
                        myPlayerId
                      )}
                    </span>

                    <span>
                      {
                        myPlayer
                          ?.totalChip ||
                        0
                      }{" "}
                      CHIP
                    </span>
                  </div>

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
                      (card) => (
                        <CardView
                          key={
                            card.id
                          }
                          card={
                            card
                          }
                          selectable={
                            Boolean(
                              myTurn &&
                                game.hasDrawn &&
                                connected
                            )
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

                  <DiscardHistory
                    playerId={
                      myPlayerId
                    }
                  />

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

            <RoomChat />
          </div>

          {error && (
            <div className="error">
              {error}
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
  .render(<App />);

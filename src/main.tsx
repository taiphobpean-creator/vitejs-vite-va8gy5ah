import React, {
  useEffect,
  useMemo,
  useState,
} from "react";

import ReactDOM from "react-dom/client";

import {
  io,
  Socket,
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
};

type Ledger = Record<
  string,
  Record<string, number>
>;

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

type Room = {
  code: string;

  hostId: string;

  multiplier: number;

  status:
    | "waiting"
    | "playing"
    | "ended";

  players: Player[];

  ledger: Ledger;

  history:
    RoundResult[];
};

type TablePlayer = {
  id: string;
  name: string;
  totalChip: number;
  cardCount: number;
  activeInRound: boolean;
};

type GameState = {
  roundNumber: number;

  phase:
    | "playing"
    | "final-round"
    | "showdown";

  hand: Card[];

  activeInRound: boolean;

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

  emojiRemaining:
    number;
};

type Reaction = {
  id: string;
  playerId: string;
  name: string;
  emoji: string;
  seed: number;
  remaining?: number;
};

// ======================================================
// SOCKET
// ======================================================

const socket: Socket =
  io(
    import.meta.env.DEV
      ? "http://localhost:3001"
      : undefined
  );

// ======================================================
// APP
// ======================================================

function App() {
  const [
    connected,
    setConnected,
  ] =
    useState(false);

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
    localEmojiLock,
    setLocalEmojiLock,
  ] =
    useState(false);

  // ====================================================
  // SOCKET EVENTS
  // ====================================================

  useEffect(
    () => {
      const onConnect =
        () =>
          setConnected(
            true
          );

      const onDisconnect =
        () =>
          setConnected(
            false
          );

      const onRoomUpdate =
        (data: Room) => {
          setRoom(
            data
          );
        };

      const onGameState =
        (
          data: GameState
        ) => {
          setGame(
            data
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
        };

      const onEmoji =
        (
          reaction:
            Reaction
        ) => {
          setReactions(
            (old) => [
              ...old,
              reaction,
            ]
          );

          setTimeout(
            () => {
              setReactions(
                (old) =>
                  old.filter(
                    (item) =>
                      item.id !==
                      reaction.id
                  )
              );
            },
            2300
          );
        };

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
        setConnected(
          true
        );
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

  const myId =
    socket.id || "";

  const isHost =
    room?.hostId ===
    myId;

  const myTurn =
    game
      ?.currentPlayerId ===
    myId;

  const myPlayer =
    room?.players.find(
      (player) =>
        player.id ===
        myId
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

  const previewScore =
    useMemo(
      () => {
        if (
          !game ||
          game.hand
            .length !== 3
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
  // CALLBACK
  // ====================================================

  function callbackError(
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

  // ====================================================
  // ROOM ACTIONS
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
        response: any
      ) => {
        if (
          !response?.ok
        ) {
          setError(
            response?.message ||
              "สร้างห้องไม่สำเร็จ"
          );

          return;
        }

        setError("");

        setRoom(
          response.room
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
        response: any
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

        setError("");

        setRoom(
          response.room
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
      callbackError
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
      callbackError
    );
  }

  // ====================================================
  // CARD ACTIONS
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
      callbackError
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
      callbackError
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
        response: any
      ) => {
        callbackError(
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
      callbackError
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
      localEmojiLock ||
      emojiRemaining <=
        0
    ) {
      return;
    }

    setLocalEmojiLock(
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
        response: any
      ) => {
        if (
          response
            ?.remaining !==
          undefined
        ) {
          setEmojiRemaining(
            response.remaining
          );
        }

        if (
          !response?.ok &&
          response
            ?.message !==
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
      () => {
        setLocalEmojiLock(
          false
        );
      },
      400
    );
  }

  // ====================================================
  // END GAME
  // ====================================================

  function endGame() {
    if (
      !room
    ) {
      return;
    }

    const yes =
      window.confirm(
        "ต้องการจบเกมหรือไม่?\n\nถ้ารอบปัจจุบันยังไม่จบ จะไม่นำรอบนี้มาคิด Chip"
      );

    if (
      !yes
    ) {
      return;
    }

    socket.emit(
      "end-game",
      {
        code:
          room.code,
      },
      callbackError
    );
  }

  // ====================================================
  // CARD VIEW
  // ====================================================

  function CardView({
    card,
    selectable = false,
  }: {
    card: Card;
    selectable?:
      boolean;
  }) {
    const red =
      card.suit ===
        "♥" ||
      card.suit ===
        "♦";

    return (
      <button
        className={[
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
        ].join(" ")}
        disabled={
          !selectable
        }
        onClick={() => {
          if (
            selectable
          ) {
            setSelectedCard(
              card.id
            );
          }
        }}
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

            const x =
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
                      `${x}px`,

                    "--emoji-drift":
                      `${drift}px`,

                    "--emoji-rotation":
                      `${rotation}deg`,
                  } as React.CSSProperties
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

  // ====================================================
  // EMOJI BAR
  // ====================================================

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
                key={emoji}
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
  // LEDGER MODAL
  // ====================================================

  function LedgerModal() {
    if (
      !room ||
      !showLedger
    ) {
      return null;
    }

    const myLedger =
      room.ledger[
        myId
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
              {myPlayer?.name}
            </span>

            <strong>
              {(
                myPlayer
                  ?.totalChip ||
                0
              ) > 0
                ? "+"
                : ""}

              {myPlayer
                ?.totalChip ||
                0}
            </strong>
          </div>

          <h3>
            ยอดระหว่างคุณกับแต่ละคน
          </h3>

          <div className="ledger-list">
            {room.players
              .filter(
                (player) =>
                  player.id !==
                  myId
              )
              .map(
                (player) => {
                  const value =
                    myLedger[
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
                      </span>

                      {value >
                      0 ? (
                        <strong className="positive">
                          ได้จาก{" "}
                          {
                            player.name
                          }{" "}
                          +
                          {
                            value
                          }
                        </strong>
                      ) : value <
                        0 ? (
                        <strong className="negative">
                          เสียให้{" "}
                          {
                            player.name
                          }{" "}
                          {
                            Math.abs(
                              value
                            )
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
          </div>

          <h3>
            ตารางคะแนนรวม
          </h3>

          <div className="total-board">
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
                    key={
                      player.id
                    }
                    className="total-row"
                  >
                    <span>
                      #
                      {index +
                        1}{" "}
                      {
                        player.name
                      }
                    </span>

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
                      }
                    </b>
                  </div>
                )
              )}
          </div>
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
              room.history
                .length
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
                    {index +
                      1}
                  </div>

                  <strong>
                    {
                      player.name
                    }
                  </strong>

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
                ไม่มียอดค้างระหว่างผู้เล่น
              </p>
            ) : (
              pairRows.map(
                (
                  row,
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
                        row.from
                      }
                    </span>

                    <strong>
                      →
                    </strong>

                    <span>
                      {row.to}
                    </span>

                    <b>
                      {
                        row.amount
                      }{" "}
                      CHIP
                    </b>
                  </div>
                )
              )
            )}
          </section>
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
              Multiplayer Card Game
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
              : "Connecting"}
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
                  event
                    .target
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
  // LOBBY
  // ====================================================

  if (
    room.status ===
      "waiting" ||
    !game
  ) {
    return (
      <div className="app">
        <LedgerModal />

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
                    className="player"
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

            {isHost ? (
              <button
                className="start-button"
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
          </section>
        </main>
      </div>
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
      <div className="app">
        <EmojiLayer />

        <LedgerModal />

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
              (player) => {
                const score =
                  game.result!
                    .scores[
                    player.id
                  ];

                // คนเข้ากลางรอบ
                // จะไม่มี score
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

                      <div className="waiting-next">
                        WAITING NEXT ROUND
                      </div>

                      <small>
                        ไม่คิด Chip รอบนี้
                      </small>
                    </div>
                  );
                }

                const net =
                  game.result!
                    .roundNet[
                    player.id
                  ] || 0;

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

                    <div className="big-score">
                      {
                        score
                      }
                    </div>

                    <div
                      className={
                        net > 0
                          ? "positive"
                          : net < 0
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
    );
  }

  // ====================================================
  // GAME
  // ====================================================

  return (
    <div className="app">
      <EmojiLayer />

      <LedgerModal />

      <header>
        <div>
          <div className="logo">
            🃏 31 SCAT
          </div>

          <div className="subtitle">
            ROOM{" "}
            {
              room.code
            }{" "}
            · ROUND{" "}
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
            🔔 FINAL ROUND —{" "}
            {playerName(
              game.knockedBy ||
                ""
            )}{" "}
            KNOCKED
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

                  {!player.activeInRound ? (
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
                game.hasDrawn
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
                !game.topDiscard
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
                  (card) => (
                    <CardView
                      key={
                        card.id
                      }
                      card={
                        card
                      }
                      selectable={
                        myTurn &&
                        game.hasDrawn
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
                        onClick={
                          drawDeck
                        }
                      >
                        DRAW DECK
                      </button>

                      <button
                        className="action draw"
                        disabled={
                          !game.topDiscard
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
                        !selectedCard
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
  );
}

ReactDOM
  .createRoot(
    document.getElementById(
      "root"
    )!
  )
  .render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );

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

type Room = {
  code: string;
  hostId: string;
  multiplier: number;

  status:
    | "waiting"
    | "playing";

  players: Player[];
};

type Opponent = {
  id: string;
  name: string;
  totalChip: number;
  cardCount: number;
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

  scores: Record<
    string,
    number
  >;

  roundNet: Record<
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

  hand: Card[];

  opponents:
    Opponent[];

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
};

const socket: Socket = io(
  import.meta.env.DEV
    ? "http://localhost:3001"
    : undefined
);

function App() {
  const [
    connected,
    setConnected,
  ] = useState(false);

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
    useState<Room | null>(
      null
    );

  const [
    game,
    setGame,
  ] =
    useState<GameState | null>(
      null
    );

  const [
    selectedCard,
    setSelectedCard,
  ] =
    useState<string | null>(
      null
    );

  const [
    error,
    setError,
  ] = useState("");

  useEffect(() => {
    function connect() {
      setConnected(true);
    }

    function disconnect() {
      setConnected(false);
    }

    function roomUpdate(
      newRoom: Room
    ) {
      setRoom(newRoom);
    }

    function gameUpdate(
      newGame: GameState
    ) {
      setGame(newGame);

      if (
        !newGame.hasDrawn
      ) {
        setSelectedCard(
          null
        );
      }
    }

    socket.on(
      "connect",
      connect
    );

    socket.on(
      "disconnect",
      disconnect
    );

    socket.on(
      "room-update",
      roomUpdate
    );

    socket.on(
      "game-state",
      gameUpdate
    );

    if (
      socket.connected
    ) {
      setConnected(true);
    }

    return () => {
      socket.off(
        "connect",
        connect
      );

      socket.off(
        "disconnect",
        disconnect
      );

      socket.off(
        "room-update",
        roomUpdate
      );

      socket.off(
        "game-state",
        gameUpdate
      );
    };
  }, []);

  const myId =
    socket.id || "";

  const isHost =
    room?.hostId ===
    myId;

  const myTurn =
    game
      ?.currentPlayerId ===
    myId;

  const playerName = (
    id: string
  ) => {
    return (
      room?.players.find(
        (player) =>
          player.id === id
      )?.name ||
      "Player"
    );
  };

  const calculatedPreviewScore =
    useMemo(() => {
      if (!game) {
        return 0;
      }

      const hand =
        game.hand;

      if (
        hand.length !== 3
      ) {
        return "-";
      }

      const trip =
        hand.every(
          (card) =>
            card.rank ===
            hand[0].rank
        );

      if (trip) {
        return 30.5;
      }

      const totals = {
        "♠": 0,
        "♥": 0,
        "♦": 0,
        "♣": 0,
      };

      hand.forEach(
        (card) => {
          totals[
            card.suit
          ] += card.value;
        }
      );

      return Math.max(
        ...Object.values(
          totals
        )
      );
    }, [game]);

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
      (response: any) => {
        if (
          !response.ok
        ) {
          setError(
            response.message
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
    if (!name.trim()) {
      setError(
        "กรุณาใส่ชื่อ"
      );

      return;
    }

    if (
      !roomCode.trim()
    ) {
      setError(
        "กรุณาใส่ Room Code"
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
      (response: any) => {
        if (
          !response.ok
        ) {
          setError(
            response.message
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
    if (!room) {
      return;
    }

    socket.emit(
      "start-game",
      {
        code:
          room.code,
      },
      (response: any) => {
        if (
          !response.ok
        ) {
          setError(
            response.message
          );
        }
      }
    );
  }

  function drawDeck() {
    if (!room) {
      return;
    }

    socket.emit(
      "draw-deck",
      {
        code:
          room.code,
      },
      (response: any) => {
        if (
          !response.ok
        ) {
          setError(
            response.message
          );
        } else {
          setError("");
        }
      }
    );
  }

  function drawDiscard() {
    if (!room) {
      return;
    }

    socket.emit(
      "draw-discard",
      {
        code:
          room.code,
      },
      (response: any) => {
        if (
          !response.ok
        ) {
          setError(
            response.message
          );
        } else {
          setError("");
        }
      }
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
      (response: any) => {
        if (
          !response.ok
        ) {
          setError(
            response.message
          );

          return;
        }

        setSelectedCard(
          null
        );

        setError("");
      }
    );
  }

  function knock() {
    if (!room) {
      return;
    }

    socket.emit(
      "knock",
      {
        code:
          room.code,
      },
      (response: any) => {
        if (
          !response.ok
        ) {
          setError(
            response.message
          );
        } else {
          setError("");
        }
      }
    );
  }

  function nextRound() {
    if (!room) {
      return;
    }

    socket.emit(
      "next-round",
      {
        code:
          room.code,
      },
      (response: any) => {
        if (
          !response.ok
        ) {
          setError(
            response.message
          );
        } else {
          setError("");
        }
      }
    );
  }

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
              Multiplayer
              Card Game
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
              Create Room
              แล้วส่ง Code
              ให้เพื่อน
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
    return (
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

          <div className="connection">
            <span className="dot online" />

            Connected
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

          <section className="game-table lobby-table">
            <div className="table-title">
              WAITING FOR PLAYERS
            </div>

            <div className="players">
              {room.players.map(
                (
                  player
                ) => (
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

            <div className="waiting">
              {
                room.players
                  .length
              }{" "}
              Players
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
                รอ Host
                เริ่มเกม
              </div>
            )}

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
  // SHOWDOWN
  // ====================================================

  if (
    game.phase ===
      "showdown" &&
    game.result
  ) {
    return (
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

          <div className="room-chip">
            CHIP{" "}
            {
              room.multiplier
            }
            ×
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

                const net =
                  game.result!
                    .roundNet[
                    player.id
                  ];

                return (
                  <div
                    className="result-player"
                    key={
                      player.id
                    }
                  >
                    <div className="avatar">
                      {player.name[0].toUpperCase()}
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
                      {net > 0
                        ? "+"
                        : ""}
                      {net} CHIP
                    </div>

                    <small>
                      TOTAL{" "}
                      {player.totalChip}
                    </small>
                  </div>
                );
              }
            )}
          </div>

          <section className="settlement-box">
            <h2>
              Settlement
            </h2>

            {game.result
              .settlements
              .length ===
            0 ? (
              <p>
                คะแนนเท่ากัน
              </p>
            ) : (
              game.result.settlements.map(
                (
                  line,
                  index
                ) => (
                  <div
                    className="settlement-line"
                    key={
                      index
                    }
                  >
                    <span>
                      {playerName(
                        line.loserId
                      )}
                    </span>

                    <strong>
                      →
                    </strong>

                    <span>
                      {playerName(
                        line.winnerId
                      )}
                    </span>

                    <b>
                      {
                        line.chips
                      }{" "}
                      CHIP
                    </b>

                    {line.bonus ===
                      2 && (
                      <em>
                        31 ×2
                      </em>
                    )}
                  </div>
                )
              )
            )}
          </section>

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
              รอ Host
              เริ่มรอบต่อไป
            </div>
          )}

          {error && (
            <div className="error">
              {error}
            </div>
          )}
        </main>
      </div>
    );
  }

  // ====================================================
  // GAME TABLE
  // ====================================================

  return (
    <div className="app">
      <header>
        <div>
          <div className="logo">
            🃏 31 SCAT
          </div>

          <div className="subtitle">
            ROOM{" "}
            {room.code} ·
            ROUND{" "}
            {game.roundNumber}
          </div>
        </div>

        <div className="room-chip">
          CHIP{" "}
          {
            room.multiplier
          }
          ×
        </div>
      </header>

      <main className="game-page">
        {game.phase ===
          "final-round" && (
          <div className="final-banner">
            🔔 FINAL ROUND —
            {" "}
            {playerName(
              game.knockedBy ||
                ""
            )}{" "}
            KNOCKED
          </div>
        )}

        <section className="real-table">
          <div className="opponents">
            {game.opponents.map(
              (
                opponent
              ) => (
                <div
                  className={[
                    "opponent",

                    game.currentPlayerId ===
                    opponent.id
                      ? "current-player"
                      : "",
                  ].join(" ")}
                  key={
                    opponent.id
                  }
                >
                  <strong>
                    {
                      opponent.name
                    }
                  </strong>

                  <div className="card-backs">
                    {Array.from({
                      length:
                        opponent.cardCount,
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

                  <small>
                    {
                      opponent.totalChip
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
                calculatedPreviewScore
              }
            </div>

            <div className="actions">
              {!game.hasDrawn &&
                myTurn && (
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
                      onClick={
                        drawDiscard
                      }
                      disabled={
                        !game.topDiscard
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

              {game.hasDrawn &&
                myTurn && (
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
        </section>

        {error && (
          <div className="error">
            {error}
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

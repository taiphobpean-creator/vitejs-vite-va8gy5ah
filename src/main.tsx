import React, {
  useEffect,
  useState,
} from "react";

import ReactDOM from "react-dom/client";

import {
  io,
  Socket,
} from "socket.io-client";

import "./styles.css";

// ==========================================
// TYPES
// ==========================================

type Player = {
  id: string;
  name: string;
  totalChip: number;
};

type RoomStatus =
  | "waiting"
  | "playing";

type Room = {
  code: string;
  hostId: string;
  multiplier: number;
  status: RoomStatus;
  players: Player[];
};

// ==========================================
// SOCKET
// ==========================================

const socket: Socket = io(
  import.meta.env.DEV
    ? "http://localhost:3001"
    : undefined
);

// ==========================================
// APP
// ==========================================

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
    error,
    setError,
  ] = useState("");

  // ========================================
  // SOCKET EVENTS
  // ========================================

  useEffect(() => {
    function handleConnect() {
      console.log(
        "Connected:",
        socket.id
      );

      setConnected(true);
    }

    function handleDisconnect() {
      setConnected(false);
    }

    function handleRoomUpdate(
      updatedRoom: Room
    ) {
      console.log(
        "Room update:",
        updatedRoom
      );

      setRoom(updatedRoom);
    }

    function handleGameStarted(
      data: any
    ) {
      console.log(
        "Game started:",
        data
      );
    }

    socket.on(
      "connect",
      handleConnect
    );

    socket.on(
      "disconnect",
      handleDisconnect
    );

    socket.on(
      "room-update",
      handleRoomUpdate
    );

    socket.on(
      "game-started",
      handleGameStarted
    );

    // กรณี socket connect
    // ก่อน React render
    if (socket.connected) {
      setConnected(true);
    }

    return () => {
      socket.off(
        "connect",
        handleConnect
      );

      socket.off(
        "disconnect",
        handleDisconnect
      );

      socket.off(
        "room-update",
        handleRoomUpdate
      );

      socket.off(
        "game-started",
        handleGameStarted
      );
    };
  }, []);

  // ========================================
  // CREATE ROOM
  // ========================================

  function createRoom() {
    if (!name.trim()) {
      setError(
        "กรุณาใส่ชื่อ"
      );

      return;
    }

    if (!connected) {
      setError(
        "ยังไม่เชื่อมต่อ Server"
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

  // ========================================
  // JOIN ROOM
  // ========================================

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

    if (!connected) {
      setError(
        "ยังไม่เชื่อมต่อ Server"
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
          !response?.ok
        ) {
          setError(
            response?.message ||
              "เข้าห้องไม่สำเร็จ"
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

  // ========================================
  // START GAME
  // ========================================

  function startGame() {
    if (!room) {
      return;
    }

    setError("");

    socket.emit(
      "start-game",
      {
        code: room.code,
      },
      (response: any) => {
        if (
          !response?.ok
        ) {
          setError(
            response?.message ||
              "เริ่มเกมไม่สำเร็จ"
          );

          return;
        }

        console.log(
          "Start game success"
        );
      }
    );
  }

  // ========================================
  // GAME SCREEN
  // ========================================

  if (
    room &&
    room.status === "playing"
  ) {
    return (
      <div className="app">
        <header>
          <div>
            <div className="logo">
              🃏 31 SCAT
            </div>

            <div className="subtitle">
              ROOM {room.code}
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
              ? "Connected"
              : "Disconnected"}
          </div>
        </header>

        <main className="room-page">
          <div className="room-info">
            <div>
              ROOM CODE
            </div>

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

          <section className="game-table">
            <div className="table-title">
              GAME STARTED
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
                      {player.totalChip >
                      0
                        ? "+"
                        : ""}

                      {
                        player.totalChip
                      }{" "}
                      CHIP
                    </div>
                  </div>
                )
              )}
            </div>

            <div
              style={{
                textAlign:
                  "center",

                marginTop:
                  "10px",

                fontSize:
                  "28px",

                fontWeight:
                  "900",

                color:
                  "#e4bd60",
              }}
            >
              🎮 เกมเริ่มแล้ว
            </div>

            <div
              style={{
                textAlign:
                  "center",

                marginTop:
                  "10px",

                color:
                  "#91a7a0",
              }}
            >
              ขั้นต่อไป:
              แจกไพ่ 3 ใบ
            </div>
          </section>
        </main>
      </div>
    );
  }

  // ========================================
  // WAITING ROOM
  // ========================================

  if (room) {
    const isHost =
      socket.id ===
      room.hostId;

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
              ? "Connected"
              : "Disconnected"}
          </div>
        </header>

        <main className="room-page">
          <div className="room-info">
            <div>
              ROOM CODE
            </div>

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

          <section className="game-table">
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
                      {player.totalChip >
                      0
                        ? "+"
                        : ""}

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

            {isHost && (
              <button
                className="start-button"
                onClick={
                  startGame
                }
              >
                START GAME
              </button>
            )}

            {!isHost && (
              <div
                style={{
                  textAlign:
                    "center",

                  marginTop:
                    "20px",

                  color:
                    "#91a7a0",
                }}
              >
                รอ Host
                เริ่มเกม...
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

  // ========================================
  // HOME
  // ========================================

  return (
    <div className="app">
      <header>
        <div>
          <div className="logo">
            🃏 31 SCAT
          </div>

          <div className="subtitle">
            Multiplayer Card
            Game
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
            <span>♠</span>
            <span>♥</span>
            <span>♦</span>
            <span>♣</span>
          </div>

          <h1>
            31
            <span>
              {" "}
              SCAT
            </span>
          </h1>

          <p>
            สร้างห้อง ส่ง
            Room Code
            ให้เพื่อน
            แล้วเริ่มเกม
          </p>
        </section>

        <section className="panel">
          <label>
            YOUR NAME
          </label>

          <input
            value={name}
            onChange={(
              e
            ) =>
              setName(
                e.target
                  .value
              )
            }
            placeholder="ชื่อผู้เล่น"
          />

          <div className="divider">
            CREATE ROOM
          </div>

          <label>
            CHIP MULTIPLIER
          </label>

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
              e
            ) =>
              setRoomCode(
                e.target.value.toUpperCase()
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

// ==========================================
// RENDER
// ==========================================

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

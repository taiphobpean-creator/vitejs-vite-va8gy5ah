import React, {
  useEffect,
  useState
} from "react";

import ReactDOM from "react-dom/client";
import { io, Socket } from "socket.io-client";

import "./styles.css";

type Player = {
  id: string;
  name: string;
  totalChip: number;
};

type Room = {
  code: string;
  hostId: string;
  multiplier: number;
  players: Player[];
};

const socket: Socket = io(
  import.meta.env.DEV
    ? "http://localhost:3001"
    : undefined
);

function App() {
  const [connected, setConnected] =
    useState(false);

  const [name, setName] =
    useState("");

  const [roomCode, setRoomCode] =
    useState("");

  const [multiplier, setMultiplier] =
    useState(2);

  const [room, setRoom] =
    useState<Room | null>(null);

  const [error, setError] =
    useState("");

  useEffect(() => {
    socket.on("connect", () => {
      setConnected(true);
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    socket.on(
      "room-update",
      (updatedRoom: Room) => {
        setRoom(updatedRoom);
      }
    );

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("room-update");
    };
  }, []);

  function createRoom() {
    if (!name.trim()) {
      setError("กรุณาใส่ชื่อ");
      return;
    }

    socket.emit(
      "create-room",
      {
        name,
        multiplier
      },
      (response: any) => {
        if (!response.ok) {
          setError(
            response.message ||
              "สร้างห้องไม่สำเร็จ"
          );

          return;
        }

        setError("");
        setRoom(response.room);
      }
    );
  }

  function joinRoom() {
    if (!name.trim()) {
      setError("กรุณาใส่ชื่อ");
      return;
    }

    if (!roomCode.trim()) {
      setError("กรุณาใส่ Room Code");
      return;
    }

    socket.emit(
      "join-room",
      {
        name,
        code: roomCode
      },
      (response: any) => {
        if (!response.ok) {
          setError(response.message);
          return;
        }

        setError("");
        setRoom(response.room);
      }
    );
  }

  if (room) {
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
              CHIP {room.multiplier}×
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
                    key={player.id}
                  >
                    <div className="avatar">
                      {player.name
                        .charAt(0)
                        .toUpperCase()}
                    </div>

                    <strong>
                      {player.name}
                    </strong>

                    {player.id ===
                      room.hostId && (
                      <span className="host">
                        HOST
                      </span>
                    )}

                    <div className="chips">
                      {player.totalChip > 0
                        ? "+"
                        : ""}
                      {player.totalChip}
                      {" CHIP"}
                    </div>
                  </div>
                )
              )}
            </div>

            <div className="waiting">
              {room.players.length} Players
            </div>

            {socket.id === room.hostId && (
              <button className="start-button">
                START GAME
              </button>
            )}
          </section>
        </main>
      </div>
    );
  }

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
            <span> SCAT</span>
          </h1>

          <p>
            สร้างห้อง ส่ง Room Code
            ให้เพื่อน แล้วเริ่มเกม
          </p>
        </section>

        <section className="panel">
          <label>
            YOUR NAME
          </label>

          <input
            value={name}
            onChange={(e) =>
              setName(e.target.value)
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
            {[1, 2, 5, 10].map(
              (value) => (
                <button
                  key={value}
                  className={
                    multiplier === value
                      ? "selected"
                      : ""
                  }
                  onClick={() =>
                    setMultiplier(value)
                  }
                >
                  {value}×
                </button>
              )
            )}
          </div>

          <button
            className="primary"
            onClick={createRoom}
          >
            CREATE ROOM
          </button>

          <div className="divider">
            OR JOIN
          </div>

          <input
            value={roomCode}
            maxLength={4}
            onChange={(e) =>
              setRoomCode(
                e.target.value.toUpperCase()
              )
            }
            placeholder="ROOM CODE"
          />

          <button
            className="secondary"
            onClick={joinRoom}
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

ReactDOM
  .createRoot(
    document.getElementById("root")!
  )
  .render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );

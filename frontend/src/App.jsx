import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Home from "./routes/Home.jsx";
import SoloPlay from "./routes/SoloPlay.jsx";
import DailyPuzzle from "./routes/DailyPuzzle.jsx";
import Leaderboard from "./routes/Leaderboard.jsx";
import Lobby from "./routes/Lobby.jsx";
import GameRoom from "./routes/GameRoom.jsx";
import MultiplayerLeaderboard from "./routes/MultiplayerLeaderboard.jsx";
import Splash from "./components/Splash.jsx";
import PaperOverlay from "./components/PaperOverlay.jsx";
import MuteToggle from "./components/MuteToggle.jsx";

export default function App() {
  return (
    <>
      <PaperOverlay />
      <MuteToggle />
      <Splash />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/practice" element={<SoloPlay mode="practice" />} />
        <Route path="/daily-timed" element={<SoloPlay mode="daily_timed" />} />
        <Route path="/daily-untimed" element={<SoloPlay mode="daily_untimed" />} />
        <Route path="/today" element={<DailyPuzzle />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/daily-leaderboard" element={<Leaderboard endpoint="/api/leaderboard/daily-puzzle" title="Daily Puzzle Leaderboard" />} />
        <Route path="/lobby" element={<Lobby />} />
        <Route path="/game/:code" element={<GameRoom />} />
        <Route path="/multiplayer-leaderboard" element={<MultiplayerLeaderboard />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

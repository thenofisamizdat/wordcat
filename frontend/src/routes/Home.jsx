import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.js";
import LoginForm from "../components/LoginForm.jsx";
import ShareButton from "../components/ShareButton.jsx";

export default function Home() {
  const { isAuthed, name, isGuest, logout } = useAuth();
  const navigate = useNavigate();
  const [practiceOpen, setPracticeOpen] = useState(false);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <header className="relative">
        <div className="absolute left-0 top-0">
          <ShareButton />
        </div>
        {isAuthed && (
          <div className="absolute right-14 top-0 text-right text-sm">
            <div className="font-semibold">{name} {isGuest && <span className="text-stone-500 font-normal">(guest)</span>}</div>
            <button onClick={logout} className="text-stone-500 hover:text-stone-800 underline text-xs">Sign out</button>
          </div>
        )}
        <div className="flex flex-col items-center text-center">
          <img src="/logo.svg" alt="WordCat" className="w-full max-w-3xl h-auto -my-6" />
          <p className="text-stone-600 -mt-2 max-w-md">A cat(egory) game about words. Form a word from the shared pool that fits the drawn category.</p>
        </div>
      </header>

      {!isAuthed ? (
        <LoginForm />
      ) : (
        <div className="space-y-2 max-w-2xl mx-auto">
          <div className="grid sm:grid-cols-2 gap-3">
            <Link to="/daily-timed" className="block bg-white rounded-lg p-3 shadow-sm border border-stone-200 hover:shadow-md transition text-center">
              <div className="text-[0.65rem] uppercase tracking-wider text-amber-700 font-semibold">Daily Challenge · Timed</div>
              <div className="text-base font-bold mt-0.5">One run per day</div>
              <p className="text-stone-600 text-xs mt-1">Same shuffle for everyone. 20s per turn, 3 min total.</p>
            </Link>
            <Link to="/daily-untimed" className="block bg-white rounded-lg p-3 shadow-sm border border-stone-200 hover:shadow-md transition text-center">
              <div className="text-[0.65rem] uppercase tracking-wider text-amber-600 font-semibold">Daily Challenge · Untimed</div>
              <div className="text-base font-bold mt-0.5">One run per day</div>
              <p className="text-stone-600 text-xs mt-1">Same shuffle for everyone. No time pressure.</p>
            </Link>
            <button
              onClick={() => setPracticeOpen((o) => !o)}
              className="block w-full bg-white rounded-lg p-3 shadow-sm border border-stone-200 hover:shadow-md transition text-center"
            >
              <div className="text-[0.65rem] uppercase tracking-wider text-emerald-700 font-semibold">Free Fire</div>
              <div className="text-base font-bold mt-0.5">Solo, unlimited</div>
              <p className="text-stone-600 text-xs mt-1">Fresh shuffle every time.</p>
            </button>
            <Link to="/lobby" className="block bg-white rounded-lg p-3 shadow-sm border border-stone-200 hover:shadow-md transition text-center">
              <div className="text-[0.65rem] uppercase tracking-wider text-sky-700 font-semibold">Multiplayer</div>
              <div className="text-base font-bold mt-0.5">2–6 players</div>
              <p className="text-stone-600 text-xs mt-1">Invite friends, take turns.</p>
            </Link>
          </div>

          {practiceOpen && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 space-y-2">
              <div className="text-xs text-stone-600 font-medium">Choose Free Fire mode:</div>
              <div className="flex gap-2">
                <button
                  onClick={() => navigate("/practice?timed=1")}
                  className="flex-1 bg-white border border-emerald-300 hover:bg-emerald-100 rounded-lg p-2 text-center text-sm font-semibold transition"
                >
                  Timed
                  <div className="text-xs text-stone-500 font-normal mt-0.5">20s per turn · 3 min total</div>
                </button>
                <button
                  onClick={() => navigate("/practice?timed=0")}
                  className="flex-1 bg-white border border-emerald-300 hover:bg-emerald-100 rounded-lg p-2 text-center text-sm font-semibold transition"
                >
                  No Timer
                  <div className="text-xs text-stone-500 font-normal mt-0.5">Play at your own pace</div>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {isAuthed && (
        <div className="text-center text-sm space-x-3">
          <Link to="/leaderboard" className="text-stone-500 hover:text-stone-800 underline">
            Daily leaderboard
          </Link>
          <span className="text-stone-300">·</span>
          <Link to="/multiplayer-leaderboard" className="text-stone-500 hover:text-stone-800 underline">
            Top multiplayer players
          </Link>
        </div>
      )}
    </div>
  );
}

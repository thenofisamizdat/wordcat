import React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.js";
import LoginForm from "../components/LoginForm.jsx";
import ShareButton from "../components/ShareButton.jsx";

export default function Home() {
  const { isAuthed, name, isGuest, logout } = useAuth();
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
        <div className="grid sm:grid-cols-3 gap-3 max-w-2xl mx-auto">
          <Link to="/practice" className="block bg-white rounded-lg p-3 shadow-sm border border-stone-200 hover:shadow-md transition text-center">
            <div className="text-[0.65rem] uppercase tracking-wider text-emerald-700 font-semibold">Free Fire</div>
            <div className="text-base font-bold mt-0.5">Solo, unlimited</div>
            <p className="text-stone-600 text-xs mt-1">Fresh shuffle every time.</p>
          </Link>
          <Link to="/daily" className="block bg-white rounded-lg p-3 shadow-sm border border-stone-200 hover:shadow-md transition text-center">
            <div className="text-[0.65rem] uppercase tracking-wider text-amber-700 font-semibold">Daily Challenge</div>
            <div className="text-base font-bold mt-0.5">One run per day</div>
            <p className="text-stone-600 text-xs mt-1">Same shuffle for everyone.</p>
          </Link>
          <Link to="/lobby" className="block bg-white rounded-lg p-3 shadow-sm border border-stone-200 hover:shadow-md transition text-center">
            <div className="text-[0.65rem] uppercase tracking-wider text-sky-700 font-semibold">Multiplayer</div>
            <div className="text-base font-bold mt-0.5">2–6 players</div>
            <p className="text-stone-600 text-xs mt-1">Invite friends, take turns.</p>
          </Link>
        </div>
      )}

      {isAuthed && (
        <div className="text-center">
          <Link to="/leaderboard" className="text-stone-500 hover:text-stone-800 text-sm underline">
            View today's daily leaderboard →
          </Link>
        </div>
      )}
    </div>
  );
}

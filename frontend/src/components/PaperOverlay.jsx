import React from "react";

/**
 * Decorative fixed-position overlays:
 *  - Binder/punch holes down the left edge
 *  - Bottom-right corner of the page folded back on itself
 *
 * Both sit above the body background but below all routes (z-0). They are
 * pointer-events:none so they never intercept clicks.
 */
export default function PaperOverlay() {
  return (
    <>
      {/* Binder holes — column of evenly spaced punched circles down the left edge */}
      <svg
        aria-hidden="true"
        className="pointer-events-none fixed left-0 top-0 h-screen w-12 z-0"
        viewBox="0 0 48 1000"
        preserveAspectRatio="none"
      >
        <defs>
          <radialGradient id="holeShade" cx="50%" cy="40%" r="55%">
            <stop offset="0%" stopColor="#b8a980" stopOpacity="0.55" />
            <stop offset="80%" stopColor="#7a6a48" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#3e3520" stopOpacity="0.95" />
          </radialGradient>
        </defs>
        {[80, 240, 400, 560, 720, 880].map((cy) => (
          <g key={cy}>
            <circle cx="22" cy={cy + 1.5} r="11" fill="rgba(0,0,0,0.18)" />
            <circle cx="22" cy={cy} r="11" fill="url(#holeShade)" stroke="#5a4a2c" strokeWidth="0.8" />
          </g>
        ))}
      </svg>

      {/*
        ============================================================
          Bottom-right page fold (folded back, NOT cut off)
        ============================================================
        Geometry (within a 200x200 viewBox anchored to bottom-right):
          - The fold's hinge runs diagonally from A=(200, 70) on the right edge
            to B=(70, 200) on the bottom edge.
          - The original page corner C=(200, 200) has been lifted and folded
            back onto the page; mirrored across line A-B it lands at
            C' ≈ (70, 70).
          - We draw, in z-order:
              1) A soft drop-shadow under the flap (offset down-right of the flap)
              2) The triangular HOLE where the corner used to be — coloured the
                 same as the body so it visually looks like the page ends there.
                 (We use a slightly darker shade so the underside-flap reads.)
              3) The lifted FLAP (triangle A-B-C'), shaded with a subtle
                 gradient because real paper bows when folded.
              4) The fold crease (line A-B), drawn as a slightly darker,
                 hand-drawn ink stroke.
      */}
      <svg
        aria-hidden="true"
        className="pointer-events-none fixed bottom-0 right-0 z-0"
        width="200" height="200" viewBox="0 0 200 200"
      >
        <defs>
          {/* Underside of the page: same paper tone, slightly cooler/darker
              because it's the back side and the fold curves it away from light. */}
          <linearGradient id="flapGrad" x1="100%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%"  stopColor="#e6d5ad" />
            <stop offset="55%" stopColor="#f1e3bd" />
            <stop offset="100%" stopColor="#f7ecc9" />
          </linearGradient>
          {/* The hole (where the corner used to be) — show what's underneath
              the page: a hint of the desk colour. */}
          <linearGradient id="holeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"  stopColor="#c9b585" />
            <stop offset="100%" stopColor="#a99360" />
          </linearGradient>
          {/* Soft shadow filter for the lifted flap. */}
          <filter id="flapShadow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="3"/>
            <feOffset dx="2" dy="3" result="o"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.5"/></feComponentTransfer>
            <feMerge>
              <feMergeNode/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>

        {/*
          1) The "hole" left by the lifted corner — the triangle bounded by
             A(200,70), B(70,200), C(200,200). We give it a slightly darker
             paper tone so the eye reads "missing piece of paper" rather than
             "cut corner". A subtle inner curve at the hinge sells the lift.
        */}
        <path d="M 200 70 Q 145 145 70 200 L 200 200 Z" fill="url(#holeGrad)" />

        {/*
          2) The lifted flap: triangle A-B-C' where C' is the mirror of (200,200)
             across the fold axis. For a fold along x+y=270 (i.e. the line
             through (200,70) and (70,200)), the mirror of (200,200) is (70,70).
             We curve the diagonal hypotenuse slightly outward — paper bows.
        */}
        <path
          d="
            M 200 70
            Q 145 145 70 200
            Q 60 165 65 130
            Q 70 95 90 75
            Q 130 60 200 70
            Z
          "
          fill="url(#flapGrad)"
          filter="url(#flapShadow)"
        />

        {/* 3) Fold crease (hinge line A->B), drawn as a slightly darker
              ink line with a small notch at each end where the page tears. */}
        <path
          d="M 200 70 Q 145 145 70 200"
          fill="none"
          stroke="#a08555"
          strokeWidth="1.2"
          strokeLinecap="round"
        />

        {/* 4) Subtle highlight along the upper edge of the flap to imply
              a curve catching light. */}
        <path
          d="M 90 75 Q 130 60 200 70"
          fill="none"
          stroke="rgba(255,250,235,0.6)"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    </>
  );
}

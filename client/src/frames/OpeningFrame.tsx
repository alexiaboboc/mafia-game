import React, { useEffect, useState } from "react";
import "../styles/OpeningFrame.css";
import LoginRegisterPanel from "../components/LoginRegisterPanel";

export default function OpeningFrame() {
  const [animateUp, setAnimateUp] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setAnimateUp(true);
    }, 5000); // după 5 secunde
    return () => clearTimeout(timer);
  }, []);

  const handleClick = () => {
    setAnimateUp(true); // sau la click
  };

  return (
    <div className="opening-container" onClick={handleClick}>
      <img src="/Start.png" alt="Background" className="opening-background" />

      <div
        className={`opening-logo-wrapper ${animateUp ? "logo-up" : ""}`}
      >
        <img
          src="/mafia-logo.png"
          alt="Mafia Logo"
          className="opening-logo"
        />
      </div>

      {animateUp && (
        <div className="auth-panel-wrapper">
          <LoginRegisterPanel show={animateUp} />
        </div>
      )}

    </div>
  );
}

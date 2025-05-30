import React from "react";
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import OpeningFrame from "./frames/OpeningFrame"
import Menu from "./frames/Menu";
import EnterCode from "./frames/EnterCode";
import Lobby from "./frames/Lobby";
import Options from "./frames/Options";
import FriendsPage from "./frames/FriendsPage";
import Account from "./frames/Account";
import Guide from "./frames/Guide"; 
import PrivateRoute from "./components/PrivateRoute";
import GameStart from "./frames/GameStart";
import NightActions from "./frames/NightActions";
import Chat from "./frames/Chat";
import Vote from "./frames/Vote";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<OpeningFrame />} />
        <Route path="/menu" element={<PrivateRoute><Menu /></PrivateRoute>} />
        <Route path="/enter-code" element={<PrivateRoute><EnterCode /></PrivateRoute>} />
        <Route path="/lobby" element={<PrivateRoute><Lobby /></PrivateRoute>} />
        <Route path="/options" element={<PrivateRoute><Options /></PrivateRoute>} />
        <Route path="/friends" element={<PrivateRoute><FriendsPage /></PrivateRoute>} />
        <Route path="/account" element={<PrivateRoute><Account /></PrivateRoute>} />
        <Route path="/guide" element={<PrivateRoute><Guide /></PrivateRoute>} />
        <Route path="/gamestart" element={<PrivateRoute><GameStart /></PrivateRoute>} />
        <Route path="/night-actions" element={<PrivateRoute><NightActions /></PrivateRoute>} />
        <Route path="/chat" element={<PrivateRoute><Chat /></PrivateRoute>} />
        <Route path="/vote" element={<PrivateRoute><Vote /></PrivateRoute>} />
      </Routes>
    </Router>
  );
}

export default App;
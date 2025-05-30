import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../styles/Chat.css";

const mockMessages = [
    { username: "alex55", message: "I think cooker is sus..." },
    { username: "tibi16", message: "No way, he was quiet all night." },
    { username: "cooker", message: "I was afk 😅" },
    { username: "mia", message: "Someone definitely visited me last night." },
];

export default function Chat() {
    const navigate = useNavigate();
    const [messages, setMessages] = useState(mockMessages);
    const [input, setInput] = useState("");
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const handleSend = () => {
        if (!input.trim()) return;
        setMessages([...messages, { username: "you", message: input }]);
        setInput("");
    };

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    return (
        <div className="chat-wrapper">
            <div className="chat-container">
                <div className="chat-header"> Daytime Discussion</div>
                <div className="chat-messages">
                    {messages.map((msg, index) => (
                        <div key={index} className="chat-message">
                            <span className="chat-user">{msg.username}:</span> {msg.message}
                        </div>
                    ))}
                    <div ref={messagesEndRef} /> {/* scroll marker */}
                </div>
                <div className="chat-input-wrapper">
                    <div className="chat-input-area">
                        <input
                            type="text"
                            placeholder="Write your accusation..."
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleSend()}
                        />
                        <button onClick={handleSend}>Send</button>
                    </div>

                    {/* Buton de vot sub input */}

                </div>

            </div>
            <button className="chat-vote-button" onClick={() => navigate("/vote")}>
                        Proceed to Voting
                    </button>
        </div>
    );
}
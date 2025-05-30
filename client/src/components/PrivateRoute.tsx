import React, { JSX } from "react";
import { Navigate } from "react-router-dom";

interface Props {
  children: JSX.Element;
}

export default function PrivateRoute({ children }: Props) {
  const isAuthenticated = !!localStorage.getItem("username");

  return isAuthenticated ? children : <Navigate to="/" replace />;
}
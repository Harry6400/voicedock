import React from "react";
import ReactDOM from "react-dom/client";
import { MotionConfig, LazyMotion, domAnimation } from "motion/react";
import App from "./App";
import "./styles.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      <LazyMotion features={domAnimation} strict>
        <App />
      </LazyMotion>
    </MotionConfig>
  </React.StrictMode>,
);

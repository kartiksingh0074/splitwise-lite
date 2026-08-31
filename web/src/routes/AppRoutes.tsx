import { Route, Routes } from "react-router-dom";
import { HomePage } from "./HomePage.tsx";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
    </Routes>
  );
}

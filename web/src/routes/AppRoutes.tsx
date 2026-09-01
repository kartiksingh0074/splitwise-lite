import { Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "../components/ProtectedRoute.tsx";
import { HomePage } from "./HomePage.tsx";
import { LoginPage } from "./LoginPage.tsx";
import { RegisterPage } from "./RegisterPage.tsx";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <HomePage />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

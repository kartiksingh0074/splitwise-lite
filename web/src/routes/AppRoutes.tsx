import type { ReactNode } from "react";
import { Route, Routes } from "react-router-dom";
import { AppLayout } from "../components/AppLayout.tsx";
import { ProtectedRoute } from "../components/ProtectedRoute.tsx";
import { CreateGroupPage } from "./CreateGroupPage.tsx";
import { GroupDetailPage } from "./GroupDetailPage.tsx";
import { GroupsListPage } from "./GroupsListPage.tsx";
import { HomePage } from "./HomePage.tsx";
import { LoginPage } from "./LoginPage.tsx";
import { RegisterPage } from "./RegisterPage.tsx";

function Authenticated({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute>
      <AppLayout>{children}</AppLayout>
    </ProtectedRoute>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/"
        element={
          <Authenticated>
            <HomePage />
          </Authenticated>
        }
      />
      <Route
        path="/groups"
        element={
          <Authenticated>
            <GroupsListPage />
          </Authenticated>
        }
      />
      <Route
        path="/groups/new"
        element={
          <Authenticated>
            <CreateGroupPage />
          </Authenticated>
        }
      />
      <Route
        path="/groups/:id"
        element={
          <Authenticated>
            <GroupDetailPage />
          </Authenticated>
        }
      />
    </Routes>
  );
}

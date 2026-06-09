import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { useEffect, useState } from "react";
import { ChatPage } from "./pages/ChatPage";
import { LoginPage } from "./pages/LoginPage";
import { auth } from "./lib/firebase";

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-100 text-sm text-slate-500">
        Loading...
      </main>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return <ChatPage user={user} onSignOut={() => signOut(auth)} />;
}


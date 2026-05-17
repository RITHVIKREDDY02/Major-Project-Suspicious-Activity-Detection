import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { User } from "@workspace/api-client-react";
import { useGetCurrentUser } from "@workspace/api-client-react";

interface AuthContextType {
  user: (User & { isAdmin?: boolean }) | null;
  isLoading: boolean;
  setUser: (user: (User & { isAdmin?: boolean }) | null) => void;
  isAuthenticated: boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const { data: currentUser, isLoading: isQueryLoading, error } = useGetCurrentUser({
    query: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  });

  useEffect(() => {
    if (!isQueryLoading) {
      if (currentUser && !error) {
        setUser(currentUser);
      } else {
        setUser(null);
      }
      setIsLoading(false);
    }
  }, [currentUser, isQueryLoading, error]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        setUser,
        isAuthenticated: !!user,
        isAdmin: !!(user as (User & { isAdmin?: boolean }) | null)?.isAdmin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

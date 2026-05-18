import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '../types';
import { authApi } from '../services/api';

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<void>;
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isLoading: false,

      login: async (email: string, password: string) => {
        set({ isLoading: true });
        try {
          const response = await authApi.login(email, password);
          if (response.success && response.data) {
            set({
              user: response.data.user,
              token: response.data.token,
              isLoading: false
            });
            localStorage.setItem('token', response.data.token);
          } else {
            throw new Error(response.error || 'Login failed');
          }
        } catch (error) {
          set({ isLoading: false });
          throw error;
        }
      },

      logout: () => {
        localStorage.removeItem('token');
        set({ user: null, token: null });
      },

      checkAuth: async () => {
        const token = get().token || localStorage.getItem('token');
        if (!token) {
          set({ user: null, token: null });
          return;
        }

        try {
          const response = await authApi.me();
          if (response.success && response.data) {
            set({ user: response.data, token });
          } else {
            set({ user: null, token: null });
            localStorage.removeItem('token');
          }
        } catch {
          set({ user: null, token: null });
          localStorage.removeItem('token');
        }
      }
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ token: state.token })
    }
  )
);

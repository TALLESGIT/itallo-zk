import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export interface GameSetting {
  id: string;
  game_name: string;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export const useGameSettings = () => {
  const [gameSettings, setGameSettings] = useState<GameSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { authState } = useAuth();

  const defaultSettings = [
    { game_name: 'word_guess', is_enabled: false },
    { game_name: 'number_guess', is_enabled: false },
    { game_name: 'memory_game', is_enabled: false },
    { game_name: 'quiz_game', is_enabled: false },
    { game_name: 'word_search', is_enabled: false },
    { game_name: 'hangman_game', is_enabled: false },
  ];

  const fetchGameSettings = async () => {
    try {
      setLoading(true);
      setError(null);

      // Try to fetch from Supabase first
      const { data, error: supabaseError } = await supabase
        .from('game_settings')
        .select('*')
        .order('game_name');

      if (supabaseError) {
        console.warn('Supabase not available, using localStorage:', supabaseError.message);
        // Fallback to localStorage
        const stored = localStorage.getItem('gameSettings');
        if (stored) {
          const parsedSettings = JSON.parse(stored);
          // Migrate old rock_paper_scissors to word_search
          const migratedSettings = parsedSettings.map((setting: any) => 
            setting.game_name === 'rock_paper_scissors' 
              ? { ...setting, game_name: 'word_search' }
              : setting
          );
          setGameSettings(migratedSettings);
          localStorage.setItem('gameSettings', JSON.stringify(migratedSettings));
        } else {
          // Initialize with default settings
          const initialSettings = defaultSettings.map((setting, index) => ({
            id: `local-${index}`,
            ...setting,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }));
          setGameSettings(initialSettings);
          localStorage.setItem('gameSettings', JSON.stringify(initialSettings));
        }
      } else {
        setGameSettings(data || []);
      }
    } catch (err) {
      console.error('Error fetching game settings:', err);
      setError('Erro ao carregar configurações dos jogos');
    } finally {
      setLoading(false);
    }
  };

  const updateGameSetting = async (gameName: string, isEnabled: boolean) => {
    try {
      setError(null);
      console.log('Tentando atualizar jogo:', gameName, 'para:', isEnabled);

      // Try to update in Supabase first
      const { data, error: supabaseError } = await supabase
        .from('game_settings')
        .update({ is_enabled: isEnabled, updated_at: new Date().toISOString() })
        .eq('game_name', gameName)
        .select();

      // Se nenhum registro foi atualizado, significa que ainda não existe – então cria um novo
      if (!supabaseError && (data === null || (Array.isArray(data) && data.length === 0))) {
        const { error: insertError } = await supabase
          .from('game_settings')
          .insert({
            game_name: gameName,
            is_enabled: isEnabled,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        if (insertError) {
          console.error('Erro ao inserir nova configuração:', insertError);
          throw insertError;
        }
      }

      if (supabaseError) {
        console.error('Erro do Supabase:', supabaseError);
        console.warn('Supabase not available, using localStorage:', supabaseError.message);
        // Fallback to localStorage
        const updatedSettings = gameSettings.map(setting =>
          setting.game_name === gameName
            ? { ...setting, is_enabled: isEnabled, updated_at: new Date().toISOString() }
            : setting
        );
        setGameSettings(updatedSettings);
        localStorage.setItem('gameSettings', JSON.stringify(updatedSettings));
      } else {
        console.log('Atualização bem-sucedida:', data);
        // Refresh from Supabase
        await fetchGameSettings();
      }
    } catch (err) {
      console.error('Error updating game setting:', err);
      setError('Erro ao atualizar configuração do jogo');
    }
  };

  const isGameEnabled = (gameName: string): boolean => {
    const setting = gameSettings.find(s => s.game_name === gameName);
    return setting?.is_enabled || false;
  };

  const isAdmin = authState.user?.user_metadata?.role === 'admin';

  useEffect(() => {
    fetchGameSettings();

    // Escutar mudanças em tempo real na tabela game_settings (Supabase)
    const channel = supabase
      .channel('public:game_settings')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'game_settings' },
        (payload: any) => {
          // Atualiza estado local de forma otimista sem depender somente de nova query
          setGameSettings(prev => {
            const idx = prev.findIndex(s => s.game_name === payload.new?.game_name);
            if (payload.eventType === 'DELETE') {
              // Remove configuração deletada
              if (idx !== -1) {
                const copy = [...prev];
                copy.splice(idx, 1);
                return copy;
              }
              return prev;
            }

            // Para INSERT ou UPDATE
            const newSetting = {
              id: payload.new.id,
              game_name: payload.new.game_name,
              is_enabled: payload.new.is_enabled,
              created_at: payload.new.created_at,
              updated_at: payload.new.updated_at,
            } as GameSetting;

            if (idx !== -1) {
              const copy = [...prev];
              copy[idx] = newSetting;
              return copy;
            }
            return [...prev, newSetting];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return {
    gameSettings,
    loading,
    error,
    updateGameSetting,
    isGameEnabled,
    isAdmin,
    refetch: fetchGameSettings,
  };
}; 
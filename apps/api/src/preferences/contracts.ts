/** DTOs y parámetros propios del dominio de preferencias persistentes. */

/** Preferencia persistente serializada para el cliente o el agente. */
export type UserPreferenceDto = {
  id: string;
  preference: string;
  activationCondition: string;
  category: string | null;
  createdAt: string;
  score?: number;
};

/** Preferencia y condición de activación que se guardarán para un usuario. */
export type SavePreferenceParams = {
  userId: string;
  preference: string;
  activationCondition: string;
  category?: string | null;
};

/** Consulta de recuperación de preferencias aplicables a un usuario. */
export type SearchPreferencesParams = {
  userId: string;
  query: string;
  limit?: number;
};

/** Cursor estable para paginar preferencias por creación e identificador. */
export type PreferenceCursor = {
  createdAt: string;
  id: string;
};

/** Usuario y cursor/límite para listar preferencias guardadas. */
export type ListPreferencesParams = {
  userId: string;
  limit?: number;
  before?: PreferenceCursor;
};

/** Identificadores del usuario y preferencia que se eliminará. */
export type DeletePreferenceParams = {
  userId: string;
  id: string;
};

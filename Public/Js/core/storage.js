 







function safeParse(rawValue, fallback) {
  if (rawValue === null) return fallback;
  try {
    const parsed = JSON.parse(rawValue);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

export function readJson(key, fallback = null) {
  try {
    return safeParse(localStorage.getItem(key), fallback);
  } catch {
    return fallback;
  }
}

export function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;  
  }
}

export function readString(key, fallback = null) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeString(key, value) {
  try {
    localStorage.setItem(key, String(value));
    return true;
  } catch {
    return false;
  }
}

export function remove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
     
  }
}

 
export const session = {
  get(key) {
    try {
      return safeParse(sessionStorage.getItem(key), null);
    } catch {
      return null;
    }
  },
  set(key, data) {
    try {
      sessionStorage.setItem(key, JSON.stringify({ data, savedAt: Date.now() }));
    } catch {
       
    }
  }
};

 
export const persistentCache = {
  get(key) {
    try {
      return safeParse(localStorage.getItem(key), null);
    } catch {
      return null;
    }
  },
  set(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify({ data, savedAt: Date.now() }));
    } catch {
       
    }
  }
};

export const STORAGE_KEYS = {
  users: "mirai_users",
  currentUser: "mirai_current_user",
  watchHistory: "watchHistory",
  watchList: "mirai_watch_list",
  comments: "mirai_comments",
  theaterMode: "theaterMode",
  selectedServer: "selectedServer",
  seenGuide: "mirai_seen_guide_v4",
  fanartLikes: "mirai_fanart_likes"
};

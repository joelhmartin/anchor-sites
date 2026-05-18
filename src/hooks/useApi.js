import { useState, useCallback } from "react";
import api from "../config/api.js";

export function useApi() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const request = useCallback(async (method, url, data, options = {}) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api({ method, url, data, ...options });
      return response.data;
    } catch (err) {
      const message =
        err.response?.data?.error?.message || err.message || "An error occurred";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const get = useCallback((url, options) => request("get", url, null, options), [request]);
  const post = useCallback((url, data, options) => request("post", url, data, options), [request]);
  const patch = useCallback((url, data, options) => request("patch", url, data, options), [request]);
  const del = useCallback((url, options) => request("delete", url, null, options), [request]);

  return { loading, error, get, post, patch, del, setError };
}

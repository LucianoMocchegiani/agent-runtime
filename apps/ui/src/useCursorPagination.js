import { useCallback, useEffect, useRef, useState } from 'react';

export default function useCursorPagination({
  fetchPage,
  resetKey,
  limit = 20,
  rootMargin = '120px',
  loadErrorMessage,
  loadMoreErrorMessage,
}) {
  const [items, setItems] = useState([]);
  const [loadState, setLoadState] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState('');
  const rootRef = useRef(null);
  const sentinelRef = useRef(null);
  const loadingMoreRef = useRef(false);
  const generationRef = useRef(0);

  useEffect(() => {
    let active = true;
    const generation = ++generationRef.current;
    setLoadState('loading');
    setLoadError('');
    setLoadMoreError('');
    setItems([]);
    setHasMore(false);
    setNextCursor(null);
    loadingMoreRef.current = false;
    setLoadingMore(false);

    fetchPage({ limit })
      .then(page => {
        if (!active || generationRef.current !== generation) return;
        setItems(page.items);
        setHasMore(page.hasMore);
        setNextCursor(page.nextCursor);
        setLoadState('ready');
      })
      .catch(error => {
        if (!active || generationRef.current !== generation) return;
        setLoadError(error.message || loadErrorMessage);
        setLoadState('error');
      });

    return () => {
      active = false;
      if (generationRef.current === generation) generationRef.current++;
    };
  }, [fetchPage, limit, loadErrorMessage, resetKey]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore || !nextCursor) return;
    const generation = generationRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError('');
    try {
      const page = await fetchPage({ limit, cursor: nextCursor });
      if (generationRef.current !== generation) return;
      setItems(current => {
        const merged = new Map(current.map(item => [item.id, item]));
        for (const item of page.items) merged.set(item.id, item);
        return [...merged.values()];
      });
      setHasMore(page.hasMore);
      setNextCursor(page.nextCursor);
    } catch (error) {
      if (generationRef.current === generation) setLoadMoreError(error.message || loadMoreErrorMessage);
    } finally {
      if (generationRef.current === generation) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [fetchPage, hasMore, limit, loadMoreErrorMessage, nextCursor]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = rootRef.current;
    if (!sentinel || !root || !hasMore || !nextCursor || loadState !== 'ready' || loadMoreError) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadMore();
    }, { root, rootMargin });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore, loadState, loadMoreError, nextCursor, rootMargin]);

  return {
    items,
    setItems,
    loadState,
    loadError,
    hasMore,
    loadingMore,
    loadMoreError,
    loadMore,
    rootRef,
    sentinelRef,
  };
}

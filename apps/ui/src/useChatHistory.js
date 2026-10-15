import { useCallback, useEffect, useRef, useState } from 'react';
import client from './client.js';

const MESSAGE_PAGE_SIZE = 50;
const BOTTOM_SCROLL_THRESHOLD = 2;
const DELEGATION_ACTIVE_STATUSES = new Set(['queued', 'running']);

function messageCursor(message) {
  return message ? { createdAt: message.createdAt, id: message.id } : null;
}

function sortMessages(items) {
  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export default function useChatHistory({ conversationId, isVisible, delegationStatus, addLocalImagePreviews, setError }) {
  const [messages, setMessages] = useState([]);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [isHistoryStale, setIsHistoryStale] = useState(false);
  const scrollContainerRef = useRef(null);
  const shouldStickToBottomRef = useRef(true);
  const messageLoadRequestRef = useRef(0);
  const messagesRef = useRef([]);
  const hasMoreMessagesRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const scrollRestoreRef = useRef(null);
  messagesRef.current = messages;
  hasMoreMessagesRef.current = hasMoreMessages;

  const loadMessages = useCallback(async ({ preserveHistory = false } = {}) => {
    const requestId = ++messageLoadRequestRef.current;
    if (!preserveHistory) {
      setMessages([]);
      setHasMoreMessages(false);
      hasMoreMessagesRef.current = false;
      loadingOlderRef.current = false;
      setIsLoadingOlder(false);
      shouldStickToBottomRef.current = true;
      scrollRestoreRef.current = null;
    }
    try {
      const page = await client.messages.list(conversationId, { limit: MESSAGE_PAGE_SIZE });
      if (requestId !== messageLoadRequestRef.current) return false;
      const latestItems = addLocalImagePreviews(page.items);
      if (preserveHistory) {
        const retained = messagesRef.current.filter(message => !message.pending);
        const merged = new Map([...retained, ...latestItems].map(message => [message.id, message]));
        setMessages(sortMessages([...merged.values()]));
        setHasMoreMessages(hasMoreMessagesRef.current || page.hasMore);
      } else {
        setMessages(latestItems);
        setHasMoreMessages(page.hasMore);
      }
      hasMoreMessagesRef.current = preserveHistory
        ? hasMoreMessagesRef.current || page.hasMore
        : page.hasMore;
      setIsHistoryStale(false);
      return true;
    } catch (error) {
      if (requestId === messageLoadRequestRef.current) {
        setIsHistoryStale(true);
        setError(error.message);
      }
      return false;
    }
  }, [addLocalImagePreviews, conversationId, setError]);

  const loadOlderMessages = useCallback(async () => {
    const currentMessages = messagesRef.current;
    const before = messageCursor(currentMessages[0]);
    if (!before || !hasMoreMessagesRef.current || loadingOlderRef.current) return;

    const requestId = messageLoadRequestRef.current;
    const container = scrollContainerRef.current;
    const previousHeight = container?.scrollHeight ?? 0;
    const previousTop = container?.scrollTop ?? 0;
    loadingOlderRef.current = true;
    setIsLoadingOlder(true);
    try {
      const page = await client.messages.list(conversationId, { limit: MESSAGE_PAGE_SIZE, before });
      if (requestId !== messageLoadRequestRef.current) return;
      const combined = new Map([...messagesRef.current, ...addLocalImagePreviews(page.items)].map(message => [message.id, message]));
      scrollRestoreRef.current = { height: previousHeight, top: previousTop };
      setMessages(sortMessages([...combined.values()]));
      setHasMoreMessages(page.hasMore);
      hasMoreMessagesRef.current = page.hasMore;
    } catch (error) {
      if (requestId === messageLoadRequestRef.current) setError(error.message);
    } finally {
      if (requestId === messageLoadRequestRef.current) {
        loadingOlderRef.current = false;
        setIsLoadingOlder(false);
      }
    }
  }, [addLocalImagePreviews, conversationId, setError]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    if (!delegationStatus || DELEGATION_ACTIVE_STATUSES.has(delegationStatus)) return;
    void loadMessages({ preserveHistory: true });
  }, [delegationStatus, loadMessages]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !isVisible) return;
    if (scrollRestoreRef.current) {
      const { height, top } = scrollRestoreRef.current;
      container.scrollTop = top + (container.scrollHeight - height);
      scrollRestoreRef.current = null;
      shouldStickToBottomRef.current = false;
    } else if (shouldStickToBottomRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [isVisible, messages]);

  const handleMessagesScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    // Solo retomamos el seguimiento cuando el usuario vuelve realmente al final.
    shouldStickToBottomRef.current = distanceFromBottom <= BOTTOM_SCROLL_THRESHOLD;
    if (container.scrollTop <= 100) void loadOlderMessages();
  }, [loadOlderMessages]);

  const retryHistoryLoad = useCallback(async () => {
    const loaded = await loadMessages({ preserveHistory: true });
    if (loaded) {
      setIsHistoryStale(false);
      setError(null);
    }
  }, [loadMessages, setError]);

  return {
    messages,
    setMessages,
    loadMessages,
    isLoadingOlder,
    isHistoryStale,
    setIsHistoryStale,
    scrollContainerRef,
    handleMessagesScroll,
    retryHistoryLoad,
  };
}

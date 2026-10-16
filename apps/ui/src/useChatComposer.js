import { useEffect, useRef, useState } from 'react';

export const MAX_MESSAGE_CHARS = 100_000;

export default function useChatComposer({ conversationId, canStartEditingMessage, onClearError }) {
  const [input, setInput] = useState('');
  const [editingMessage, setEditingMessage] = useState(null);
  const inputBeforeEditRef = useRef('');
  const messageInputRef = useRef(null);

  useEffect(() => {
    const textarea = messageInputRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const maxHeight = Number.parseFloat(getComputedStyle(textarea).maxHeight);
    textarea.style.height = `${Math.min(textarea.scrollHeight, Number.isFinite(maxHeight) ? maxHeight : textarea.scrollHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > textarea.clientHeight ? 'auto' : 'hidden';
  }, [input]);

  useEffect(() => {
    setEditingMessage(null);
    setInput('');
    inputBeforeEditRef.current = '';
  }, [conversationId]);

  function handleInputChange(event) {
    setInput(event.target.value);
  }

  function startEditingMessage(message) {
    if (!canStartEditingMessage(message)) return;
    inputBeforeEditRef.current = input;
    setEditingMessage(message);
    setInput(message.content);
    onClearError();
    requestAnimationFrame(() => messageInputRef.current?.focus());
  }

  function cancelEditingMessage() {
    setEditingMessage(null);
    setInput(inputBeforeEditRef.current);
    inputBeforeEditRef.current = '';
  }

  function handleInputKeyDown(event) {
    if (event.key === 'Escape' && editingMessage) {
      event.preventDefault();
      cancelEditingMessage();
      return;
    }
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();

    if (event.shiftKey) {
      const textarea = event.currentTarget;
      const { selectionStart, selectionEnd, value } = textarea;
      const nextValue = `${value.slice(0, selectionStart)}\n${value.slice(selectionEnd)}`;
      setInput(nextValue);
      requestAnimationFrame(() => {
        textarea.setSelectionRange(selectionStart + 1, selectionStart + 1);
      });
      return;
    }

    event.currentTarget.form?.requestSubmit();
  }

  return {
    input,
    setInput,
    editingMessage,
    setEditingMessage,
    inputBeforeEditRef,
    messageInputRef,
    handleInputChange,
    handleInputKeyDown,
    startEditingMessage,
    cancelEditingMessage,
  };
}

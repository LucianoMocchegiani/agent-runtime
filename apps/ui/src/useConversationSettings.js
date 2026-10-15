import { useCallback, useEffect, useState } from 'react';
import client from './client.js';

export default function useConversationSettings({ conversationId, onConversationUpdated, onError }) {
  const [conversationTitle, setConversationTitle] = useState('');
  const [agentProfileId, setAgentProfileId] = useState('');
  const [agentProfiles, setAgentProfiles] = useState([]);
  const [isChangingProfile, setIsChangingProfile] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isSavingTitle, setIsSavingTitle] = useState(false);

  useEffect(() => {
    let isCurrent = true;
    setConversationTitle('');
    setIsEditingTitle(false);
    Promise.all([client.conversations.get(conversationId), client.agentProfiles.list()])
      .then(([conversation, profiles]) => {
        if (!isCurrent) return;
        setAgentProfiles(profiles);
        setAgentProfileId(conversation.agentProfileId ?? '');
        setConversationTitle(conversation.title ?? '');
        onConversationUpdated?.(conversation);
      })
      .catch(error => {
        if (isCurrent) onError?.(error.message);
      });
    return () => { isCurrent = false; };
  }, [conversationId, onConversationUpdated, onError]);

  const refreshConversation = useCallback(async () => {
    const conversation = await client.conversations.get(conversationId);
    setConversationTitle(conversation.title ?? '');
    onConversationUpdated?.(conversation);
    return conversation;
  }, [conversationId, onConversationUpdated]);

  const changeAgentProfile = useCallback(async (event) => {
    const nextId = event.target.value;
    if (!nextId || nextId === agentProfileId || isChangingProfile) return;
    setIsChangingProfile(true);
    onError?.(null);
    try {
      const conversation = await client.conversations.patch(conversationId, { agentProfileId: nextId });
      setAgentProfileId(conversation.agentProfileId ?? '');
      onConversationUpdated?.(conversation);
    } catch (error) {
      onError?.(error.message);
    } finally {
      setIsChangingProfile(false);
    }
  }, [agentProfileId, conversationId, isChangingProfile, onConversationUpdated, onError]);

  const saveConversationTitle = useCallback(async (event) => {
    event.preventDefault();
    if (isSavingTitle) return;
    setIsSavingTitle(true);
    onError?.(null);
    try {
      const conversation = await client.conversations.patch(conversationId, { title: titleDraft });
      setConversationTitle(conversation.title ?? '');
      setTitleDraft(conversation.title ?? '');
      setIsEditingTitle(false);
      onConversationUpdated?.(conversation);
    } catch (error) {
      onError?.(error.message);
    } finally {
      setIsSavingTitle(false);
    }
  }, [conversationId, isSavingTitle, onConversationUpdated, onError, titleDraft]);

  const startEditingTitle = useCallback(() => {
    setTitleDraft(conversationTitle);
    setIsEditingTitle(true);
  }, [conversationTitle]);

  const cancelEditingTitle = useCallback(() => {
    setTitleDraft(conversationTitle);
    setIsEditingTitle(false);
  }, [conversationTitle]);

  return {
    conversationTitle,
    agentProfileId,
    agentProfiles,
    isChangingProfile,
    titleDraft,
    setTitleDraft,
    isEditingTitle,
    isSavingTitle,
    refreshConversation,
    changeAgentProfile,
    saveConversationTitle,
    startEditingTitle,
    cancelEditingTitle,
  };
}

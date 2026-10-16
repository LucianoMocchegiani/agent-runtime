import Icon from './Icon.jsx';
import MarkdownContent from './MarkdownContent.jsx';
import { collectToolMessages, ToolMessage, ToolStack } from './ToolMessages.jsx';

function hasUnstoredImage(message) {
  return message.content.includes('[Imagen adjunta; no almacenada]')
    || message.content.includes('imágenes adjuntas; no almacenadas]');
}

export function ThinkingIndicator() {
  return (
    <div className="bubble assistant thinking-indicator" role="status" aria-label="El asistente está pensando">
      <span>Pensando</span> <ActivityDots />
    </div>
  );
}

function ActivityDots() {
  return (
    <span className="activity-dots" aria-hidden="true">
      <span>.</span><span>.</span><span>.</span>
    </span>
  );
}

export function MessageList({ messages, onOpenConversation, onEditMessage }) {
  return renderMessageList(messages, onOpenConversation, onEditMessage);
}

function renderMessageList(messages, onOpenConversation, onEditMessage) {
  const rendered = [];
  let index = 0;

  while (index < messages.length) {
    const message = messages[index];
    if (!isStackableTool(message)) {
      rendered.push(<MessageBubble key={message.id} message={message} onOpenConversation={onOpenConversation} onEditMessage={onEditMessage} />);
      index++;
      continue;
    }

    const stack = collectToolMessages(messages, index);
    index = stack.nextIndex;

    rendered.push(stack.messages.length > 1
      ? <ToolStack key={`tool-stack-${message.id}`} messages={stack.messages} onOpenConversation={onOpenConversation} />
      : <MessageBubble key={message.id} message={message} onOpenConversation={onOpenConversation} onEditMessage={onEditMessage} />);
  }

  return rendered;
}

function isStackableTool(message) {
  return message?.role === 'tool';
}

function MessageBubble({ message, onOpenConversation, onEditMessage }) {
  if (message.role === 'tool') {
    return <ToolMessage message={message} onOpenConversation={onOpenConversation} />;
  }
  return (
    <div className={`bubble ${message.role}`}>
      <MarkdownContent content={message.content} preserveWhitespace={message.role === 'user'} />
      {(message.imageDataUrls ?? (message.imageDataUrl ? [message.imageDataUrl] : [])).map((imageDataUrl, index) => (
        <img className="message-image" src={imageDataUrl} alt={`Imagen adjunta ${index + 1}`} key={`${message.id}-image-${index}`} />
      ))}
      {message.role === 'user' && !message.pending && onEditMessage && !hasUnstoredImage(message) && (
        <div className="message-actions">
          <button type="button" className="message-edit-button" onClick={() => onEditMessage(message)} title="Editar y regenerar desde este mensaje" aria-label="Editar mensaje">
            <Icon name="edit" />
            <span>Editar</span>
          </button>
        </div>
      )}
    </div>
  );
}

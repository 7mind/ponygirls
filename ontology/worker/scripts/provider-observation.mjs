export function capsuleSlots(request) {
  return request.messages.flatMap(message => {
    const blocks = typeof message.content === 'string' ? [message.content] : Array.isArray(message.content)
      ? message.content.filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text) : [];
    return blocks.filter(text => text.includes('# Qualified ontology context'));
  });
}

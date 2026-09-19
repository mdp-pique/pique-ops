/** Deep link to a guest's message thread in Hospitable's own inbox, keyed by the conversation_id every synced message carries in raw_hospitable_data. */
export function hospitableThreadUrl(conversationId: string | null | undefined): string | null {
  if (!conversationId) return null;
  return `https://my.hospitable.com/inbox/thread/${conversationId}`;
}

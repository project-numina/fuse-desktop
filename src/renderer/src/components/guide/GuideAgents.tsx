import { Link } from 'react-router-dom';
import { Chapter, GuideScreenshot, GuideSection, Note } from './GuideElements';

export default function GuideAgents() {
  return <Chapter title="Agents" intro="Fuse runs Claude Code or Codex on your computer. Use the workspace’s chat panel to request changes and read what the agent did.">
    <GuideSection title="Start a conversation">
      <p>Choose <strong>New chat</strong> and write your request in the <strong>chat input</strong>, the message box with attachment controls. Name the declaration or file you want to work on so the agent has a concrete starting point.</p>
      <p>A quick term you’ll see throughout this guide: a <strong>turn</strong> is one agent response plus the tool calls it makes along the way. Send a follow-up in the same conversation to continue. If a suggested message appears in the chat input, <strong>Tab</strong> accepts it.</p>
    </GuideSection>
    <GuideSection title="Attach sources">
      <p>Use the chat input’s attachment controls to add repository sources. In <strong>Sources</strong>, you can also select lines from an available text source and attach that selection to chat.</p>
      <GuideScreenshot src="/guide/source-attachment.png" alt="Lines 1–3 selected in a sample LaTeX source, with the Attach to chat button above the editor.">Select lines in Sources, then choose Attach to chat. The range is added to your draft, ready for you to send with a request.</GuideScreenshot>
      <p>You can attach a whole PDF as a source and read it in <strong>Sources</strong>. The PDF viewer is for reading; passage-to-chat selection is available in text sources. Fuse won’t extract text from a scan with OCR (optical character recognition), so paste or transcribe an exact passage yourself when the agent needs one.</p>
    </GuideSection>
    <GuideSection title="Choose a provider and permissions">
      <p><strong>Settings → Agents</strong> sets the starting provider, model, and effort for new workspaces. Effort sets how much reasoning the provider is asked to spend on each turn; higher effort can take longer. Change an existing workspace’s configuration in its own <strong>Settings</strong> tab.</p>
      <p>Claude Code uses <strong>permission modes</strong> to control which actions need approval and may ask for approval in chat. Codex uses a <strong>sandbox</strong>, which restricts the operations available to it. Use these controls to restrict access. Telling the agent “please don’t edit” in chat is a request; it doesn’t enforce a read-only boundary.</p>
    </GuideSection>
    <GuideSection title="Read the transcript">
      <p>The conversation shows responses, tool calls, and file changes. Claude Code may start subagents, whose work also appears in the transcript. Read the final response and any errors alongside the files in the <strong>Lean</strong> tab and the diff in the <strong>Changes</strong> tab.</p>
    </GuideSection>
    <GuideSection title="Native chat history">
      <p><strong>Unread</strong> means there’s a response you haven’t seen in Fuse. It clears when the end of that response is visible in the focused chat. The count beside History and on the app icon helps you find those chats. Reading a response doesn’t approve its changes or verify its proof. Older imported sessions start without an unread badge.</p>
      <p><strong>History</strong> reads Claude Code and Codex sessions saved for the opened folder and selected Lean project. You can continue a chat started in either CLI. Fuse keeps its original provider and working directory when resuming it.</p>
      <p>The providers keep their own session files. Fuse keeps workspace links, pending messages, and any information not yet available in native history. Existing Fuse conversations remain available. <strong>Remove from Fuse</strong> hides a native chat here without deleting its provider session.</p>
      <p>If a native session is missing or unreadable, History reports the problem. Keep the provider’s session files if you want to return to those conversations.</p>
    </GuideSection>
    <Note title="Stopping and returning to work">Open <Link to="/guide/workspace" className="underline underline-offset-4">Active sessions</Link> to return to running work. Navigating away leaves the turn running. To interrupt it, press <strong>Stop</strong>; quitting Fuse also shuts down its sessions. Check for uncommitted edits afterwards. See <Link to="/guide/pull-requests" className="underline underline-offset-4">Changes</Link> for reviewing and saving changes.</Note>
  </Chapter>;
}

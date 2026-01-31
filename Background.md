# Exploring the Use of GenAI in Software Development

To experiment with Generative AI (GenAI), I created [bookmark-tom](https://github.com/tbocek/bookmark-tom), an open-source browser extension designed to synchronize and manage bookmarks across multiple devices using WebDAV as the backend for storage. Synchronizing bookmarks has been on my to-do list, and this project provided a good opportunity to test GenAI, as it has a small codebase. This is not a scientific evaluation, but rather a practical test with a real, albeit small, project.

The project is written in JavaScript and offers an easy way to keep my bookmarks organized and accessible, regardless of the browser or device being used. Bookmark-tom uses WebDAV, avoiding additional services like Firefox Sync.

I also aimed to make it compatible with [Fennec (Android)](https://gitlab.com/relan/fennecbuild) and [Wolvic (Meta Quest)](https://github.com/Igalia/wolvic), but these browsers do not support the [bookmark API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/bookmarks). In hindsight, the bookmark API is quite limited when it comes to syncing data. A better API would expose the item ID in some way, as it's currently not exposed, making it impossible to differentiate between new and modified bookmarks.

## My Experience with GenAI Tools in Development

I experimented with various GenAI coding assistants, including DeepSeek Coder V2 Lite Instruct, Llama 3.1 8B, ChatGPT 4o, and Claude 3.5 Sonnet. My goal was to assess how well these tools could integrate into my workflow and assist with coding tasks. For running DeepSeek Coder V2 Lite, Llama 3.1, and other local models, I used an [AMD Radeon RX 7900 XTX](https://www.amd.com/en/products/graphics/desktops/radeon/7000-series/amd-radeon-rx-7900xtx). Here’s my experience with self-hosted AI models:

- **DeepSeek Coder V2 Lite Instruct:** This tool proved to be quite capable, especially when integrated into an IDE using plugins like [Continue Dev](https://github.com/continuedev/continue) or [CodeGPT](https://github.com/carlrobertoh/CodeGPT). The integration requires some configuration. Despite running on a powerful consumer GPU with 24GB of RAM, I found self-hosted GenAI with [llama.cpp](https://github.com/ggerganov/llama.cpp) to be somewhat slow. It could handle a context window of around 50k tokens, which was sufficient for my work on the bookmark-tom project (approximately 700 lines of code). However, performance slowed down with larger codebases, and the 50k context limit became a constraint.

- **Llama 3.1 8B:** Llama performed slightly worse in terms of code quality compared to DeepSeek Coder V2 Lite Instruct, but it did offer the advantage of a larger context window—up to 128k tokens when using a Q4 quantized model. This made it more suitable for handling larger projects without running into context size limitations as quickly.

In terms of quality, these self-hosted models felt close to the previous levels of ChatGPT or Claude, but not quite there yet.

## Challenges and Limitations

While GenAI is a powerful tool, it is not without its challenges. Since the complexity of bookmark-tom is low, its best shown in two project (outside the bookmark-tom project) where I encountered these issues:

- **C Utility for Dvorak Key Mapping:** I wrote and now maintain a [C utility](https://github.com/tbocek/dvorak) that remaps control keys in the Dvorak layout to a regular layout, interacting directly with the [uinput kernel module](https://kernel.org/doc/html/v6.10/input/uinput.html). When trying to optimize a function that uses EVIOCGBIT to retrieve available keys in a bitmap, GenAI generated code that looked reasonable well at first glance but contained a rookie mistake, mixing 32-bit and 8-bit arrays. This error was difficult to debug because I wasn’t expecting such an obvious mistake.

- **Sui Move Smart Contract:** In another project, I wrote a smart contract for the [Sui blockchain](https://sui.io) in [Sui Move](https://sui.io/move), a language with similarities to Rust but with distinct syntax variations. Asking GenAI for help led to mixed results—sometimes the AI would confuse Sui Move with [Aptos Move](https://aptos.dev/en/build/smart-contracts) or even suggest Rust syntax. The only way to write these smart contracts was to understand the underlying concepts of Sui and Sui Move, and then ask specific, targeted questions to solve an easy tasks.

## My Take on GenAI in Software Development

Generative AI is a powerful tool that can significantly enhance productivity in software development. It allows developers to work faster, reduce barriers to learning new technologies, and tackle tasks outside their usual domain, such as creating icons or translating text. However, while the results may often appear “good enough,” it is important to note that in software development, code that looks “good enough” may actually be incorrect. Thus, it is crucial to check the GenAI output and ensure you understand the code and concepts before using it.

Will GenAI replace developers? I don’t think so. Instead, I believe it will have the opposite effect. As code generation becomes faster and easier, more developers will be needed to manage and maintain the increased volume of code. GenAI tools help with writing boilerplate code and handling routine tasks, but they are not yet advanced enough to handle more complex problems without oversight. However, it will change the way we work, making it essential to adapt and integrate these tools into your workflows.

(09.08.2024, Thomas Bocek)

---

## Update: Upgrading from 2-Way to 3-Way Sync with Claude Code / Opus 4.5 (January 2026)

After using bookmark-tom for over a year, I encountered sync issues when using 3+ machines. The original 2-way sync algorithm couldn't reliably detect what changed where, leading to false conflicts. This turned into an intense debugging session that revealed both the power and frustrations of working with AI coding assistants.

### Why Now?

I knew about the quirks in my extension - the sync issues with 3+ machines, the edge cases to avoid. For my own use, I could work around them. But then I received a review on the Firefox Add-ons page: "Funktioniert ausgezeichnet. Hat meine Probleme gelöst." (Works excellently. Solved my problems.) This changed my perspective. It wasn't just a personal tool anymore - someone else was using it, and they would run into the same papercuts I had learned to avoid. This, combined with the opportunity to learn and tinker with Claude Code / Opus 4.5, motivated me to fix the sync properly.

### The Problem

The original sync compared local bookmarks directly with remote bookmarks. This works fine for 2 machines, but with 3+ machines, you can't tell:
- Did Machine A add a bookmark, or did Machine B delete it?
- Is this a conflict, or did one machine just not sync yet?

The solution was to implement a 3-way sync with a baseline state (`oldRemoteState`), tombstones for tracking deletions, and proper change detection using "3-of-4" attribute matching (title, url, path, index).

### The Journey with Claude Code

**Starting with a plan** - I asked Claude to explore the codebase and create an implementation plan. It produced a detailed plan covering the 3-state sync algorithm, tombstone handling, and conflict detection. The plan seemed solid.

**I had to start twice** - The first attempt failed. I started by asking Claude to modify the existing 2-way sync code incrementally. The typical pattern was: I'd report what to change, and Claude would add a filter here, an exception there, growing the code with patches. But this approach never addressed the fundamental issue - the 2-way algorithm simply couldn't work for 3+ machines. The real solution required stepping back, understanding the core problem, and rewriting with a proper 3-way algorithm. Incremental fixes on a flawed foundation just created more complexity. But Claude and AI tools in general happily comply when asked and add more and more.

**Then things got frustrating:**

1. **Random edits without understanding** - At one point, Claude started modifying code without fully understanding the issue. I had to explicitly say "STOP CHANGING RANDOM CODE WITHOUT KNOWING THE ISSUE." The AI would sometimes jump to fixing symptoms rather than diagnosing the root cause.

2. **Forgetting the plan** - Despite creating a detailed plan, Claude would sometimes implement things differently or forget key parts. The plan called for local change tracking, but this wasn't implemented until I noticed tests were failing.

3. **Context loss** - The conversation ran long and the context compaction kicked in, losing earlier details. We had to work from summaries rather than the full conversation history.

### What Worked Well

- **Test-driven fixes** - Adding test cases for each edge case (ended up with 39 tests) prevented regressions
- **Explicit instructions** - Being very specific: "analyze first, give options, and ask before fixing" worked better than letting Claude autonomously modify code

### Lessons Learned

1. **Don't let AI run autonomously on complex debugging** - It will chase symptoms.

2. **Context limits matter** - Long debugging sessions hit context limits. Consider breaking work into smaller sessions.

3. **Check that the plan is actually implemented** - Don't assume. Verify that key features from the plan made it into the code.

4. **Guide architectural decisions** - The AI won't make design choices for you. For example: should the sync algorithm output insert/delete in the core and let the view transform these into insert/delete/update for display (making the view more complex)? Or should the core output insert/delete/update directly and pass this to the view? The AI will implement whatever you ask, even if it's the wrong approach.

### The Result

After several hours of iterative debugging (and cursing), the sync now works reliably with 3+ machines:
- Proper 3-way merge with baseline tracking
- Tombstones for deletion propagation
- 3-of-4 matching for conflict detection
- Clean UI with grouped position changes
- 39 test cases covering multi-machine scenarios

### Final Thoughts

Using AI for this task was faster than doing it alone, but required constant supervision. The AI excels at generating code structure and boilerplate, but debugging issues and understanding the concepts still requires human insight. The key is treating AI as a powerful tool that needs guidance, not an autonomous developer.

(31.01.2026, Thomas Bocek)

// The progress spinner for `toreda scan`.
//
// `scan` is not an Ink command — it prints a plain report to stdout. So rather
// than restructure it, the spinner mounts a throwaway Ink tree on STDERR. That
// keeps both existing contracts intact: `toreda scan > file` still captures
// only the report, and `--json` still emits nothing but JSON.
//
// Non-TTY falls back to the one-line-per-step output this replaced. A spinner
// redrawing itself into a pipe is a few hundred escape sequences and no
// information, and when you have redirected stderr the scrollback log is the
// artifact you actually wanted.

import * as React from "react";
import { Box, Text, render, type Instance } from "ink";
import Spinner from "ink-spinner";
import { c, err } from "./format";

function ScanProgress({ message }: { message: string }) {
  return (
    <Box>
      <Text color="cyan">
        <Spinner type="dots" />
      </Text>
      {/* Dim, matching the plain-text progress lines this stands in for. */}
      <Text dimColor> {message}</Text>
    </Box>
  );
}

export interface ScanProgressHandle {
  /** Pass straight to `runScan({ onProgress })`. */
  onProgress: (message: string) => void;
  /** Tear the spinner down. Safe to call twice, and safe if it never started. */
  stop: () => void;
}

/**
 * Start reporting scan progress.
 *
 * The returned `onProgress` is called from outside React, so each step just
 * re-renders the root rather than plumbing state through a context. The spinner
 * animates on its own timer regardless — it does not need the re-render.
 *
 * Always pair with `stop()` in a `finally`. An Ink tree left mounted holds the
 * event loop open, so a scan that throws would otherwise hang the CLI instead
 * of reporting the error.
 */
export function startScanProgress(): ScanProgressHandle {
  if (!process.stderr.isTTY) {
    return { onProgress: (message) => err(c.dim(`  ${message}`)), stop: () => {} };
  }

  let instance: Instance | null = null;

  return {
    onProgress: (message) => {
      const tree = <ScanProgress message={message} />;
      if (instance) {
        instance.rerender(tree);
        return;
      }
      instance = render(tree, {
        stdout: process.stderr,
        // This is a passive indicator on a non-interactive command. Ink must
        // not take over stdin or install its own SIGINT handling — Ctrl-C
        // should kill `scan` the way it always has.
        exitOnCtrlC: false,
        patchConsole: false,
      });
    },
    stop: () => {
      if (!instance) return;
      // Unmount clears the spinner line, so the report starts on a clean row
      // instead of underneath a half-drawn frame.
      instance.unmount();
      instance.cleanup();
      instance = null;
    },
  };
}

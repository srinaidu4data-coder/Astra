"""Extreme-case tests for Int16RingBuffer (UI lag fix)."""

import os
import sys
import threading
import time

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from audio_capture import Int16RingBuffer


class TestRingBufferBasics:
    def test_empty_level(self):
        r = Int16RingBuffer(1600)
        assert r.get_level() == 0.0
        assert len(r.get_all_samples()) == 0

    def test_extend_and_read(self):
        r = Int16RingBuffer(100)
        samples = np.arange(50, dtype=np.int16)
        r.extend_samples(samples)
        out = r.get_last_n_samples(50)
        assert len(out) == 50
        np.testing.assert_array_equal(out, samples)

    def test_wraparound(self):
        r = Int16RingBuffer(100)
        r.extend_samples(np.arange(80, dtype=np.int16))
        r.extend_samples(np.arange(80, 130, dtype=np.int16))  # overflows
        all_s = r.get_all_samples()
        assert len(all_s) == 100
        # Last 100 samples written: 30..129
        np.testing.assert_array_equal(all_s, np.arange(30, 130, dtype=np.int16))

    def test_oversized_chunk_keeps_tail(self):
        r = Int16RingBuffer(10)
        r.extend_samples(np.arange(100, dtype=np.int16))
        out = r.get_all_samples()
        np.testing.assert_array_equal(out, np.arange(90, 100, dtype=np.int16))

    def test_extend_bytes(self):
        r = Int16RingBuffer(1000)
        samples = (np.random.randn(500) * 1000).astype(np.int16)
        r.extend_bytes(samples.tobytes())
        assert len(r.get_all_samples()) == 500

    def test_odd_byte_length_safe(self):
        r = Int16RingBuffer(100)
        # 3 bytes — should drop last incomplete sample, not crash
        r.extend_bytes(b"\x01\x00\x02")
        assert len(r.get_all_samples()) == 1

    def test_clear(self):
        r = Int16RingBuffer(100)
        r.extend_samples(np.ones(50, dtype=np.int16))
        r.clear()
        assert len(r.get_all_samples()) == 0

    def test_level_only_uses_window(self):
        r = Int16RingBuffer(16000)
        # Quiet then loud tail
        quiet = np.zeros(15000, dtype=np.int16)
        loud = (np.ones(1000) * 10000).astype(np.int16)
        r.extend_samples(quiet)
        r.extend_samples(loud)
        level = r.get_level(window_samples=500)
        assert level > 0.1

    def test_get_last_n_more_than_available(self):
        r = Int16RingBuffer(1000)
        r.extend_samples(np.arange(10, dtype=np.int16))
        out = r.get_last_n_samples(500)
        assert len(out) == 10


class TestRingBufferConcurrency:
    def test_concurrent_writers_readers(self):
        r = Int16RingBuffer(16000)
        stop = threading.Event()
        errors = []

        def writer():
            try:
                while not stop.is_set():
                    r.extend_samples((np.random.randn(320) * 500).astype(np.int16))
            except Exception as e:
                errors.append(e)

        def reader():
            try:
                while not stop.is_set():
                    _ = r.get_level(1600)
                    _ = r.get_last_n_samples(1600)
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=writer) for _ in range(2)]
        threads += [threading.Thread(target=reader) for _ in range(2)]
        for t in threads:
            t.start()
        time.sleep(0.4)
        stop.set()
        for t in threads:
            t.join(timeout=2)
        assert not errors


class TestRingBufferPerformance:
    def test_level_is_fast_on_full_buffer(self):
        """Regression: old code listed 1.9M ints every 100ms — must stay cheap."""
        r = Int16RingBuffer(16000 * 60)  # 60s @ 16kHz
        # Fill once
        chunk = (np.random.randn(16000) * 1000).astype(np.int16)
        for _ in range(60):
            r.extend_samples(chunk)

        t0 = time.perf_counter()
        for _ in range(100):
            r.get_level(1600)
        elapsed = time.perf_counter() - t0
        # 100 level reads should be well under 100ms total on any modern machine
        assert elapsed < 0.5, f"level() too slow: {elapsed:.3f}s for 100 calls"

// Compiled in front of the user's program. Every recorded step goes to file descriptor 3 as one JSON line.
export const CLANG_FLAGS = ["-std=c++20", "-O1", "-fno-exceptions", "-w"];

// `#line` makes clang report the user's own line numbers for main.cc.
export const PRELUDE_INCLUDE = '#include "__pl.h"\n#line 1 "main.cc"\n';

export const PRELUDE = String.raw`#pragma once
#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <deque>
#include <iostream>
#include <map>
#include <queue>
#include <set>
#include <stack>
#include <string>
#include <string_view>
#include <type_traits>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>
#include <unistd.h>

namespace __pl {
constexpr int kMaxDepth = 4;
constexpr std::size_t kMaxItems = 100;
constexpr std::size_t kMaxString = 200;
constexpr long kMaxSteps = 1000;
constexpr double kMaxSeconds = 10.0;

// Overload priority: High beats Low by exact match, so the catch-all only wins when nothing else fits.
struct Low {};
struct High : Low {};

inline void quote(std::string& o, std::string_view s, std::size_t max = kMaxString) {
  o += '"';
  std::size_t n = 0;
  for (char ch : s) {
    if (n++ == max) break;
    unsigned char c = static_cast<unsigned char>(ch);
    switch (c) {
      case '"': o += "\\\""; break;
      case '\\': o += "\\\\"; break;
      case '\n': o += "\\n"; break;
      case '\r': o += "\\r"; break;
      case '\t': o += "\\t"; break;
      default:
        if (c < 0x20) { char buf[8]; std::snprintf(buf, sizeof buf, "\\u%04x", c); o += buf; }
        else o += ch;
    }
  }
  o += '"';
}

inline void str(std::string& o, std::string_view s) {
  o += "{\"t\":\"str\",\"v\":";
  quote(o, s);
  if (s.size() > kMaxString) o += ",\"cut\":true";
  o += '}';
}

template <class T> std::string_view type_name() {
  std::string_view p = __PRETTY_FUNCTION__;
  std::size_t start = p.find("T = ");
  if (start == std::string_view::npos) return "unknown";
  start += 4;
  std::size_t end = p.find_first_of(";]", start);
  return p.substr(start, end - start);
}

template <class T> void dump(std::string& o, int, const T&, Low) {
  o += "{\"t\":\"unsupported\",\"type\":";
  quote(o, type_name<T>());
  o += '}';
}

template <class T, std::enable_if_t<std::is_same_v<T, bool>, int> = 0>
void dump(std::string& o, int, const T& v, High) { o += v ? "{\"t\":\"bool\",\"v\":true}" : "{\"t\":\"bool\",\"v\":false}"; }

template <class T, std::enable_if_t<std::is_same_v<T, char>, int> = 0>
void dump(std::string& o, int, const T& v, High) { str(o, std::string_view(&v, 1)); }

template <class T, std::enable_if_t<std::is_integral_v<T> && !std::is_same_v<T, bool> && !std::is_same_v<T, char>, int> = 0>
void dump(std::string& o, int, const T& v, High) {
  constexpr long double kSafe = 9007199254740991.0L;
  const bool safe = static_cast<long double>(v) <= kSafe && static_cast<long double>(v) >= -kSafe;
  o += "{\"t\":\"num\",\"v\":";
  if (safe) o += std::to_string(v);
  else { o += '"'; o += std::to_string(v); o += '"'; }
  o += '}';
}

template <class T, std::enable_if_t<std::is_floating_point_v<T>, int> = 0>
void dump(std::string& o, int, const T& v, High) {
  o += "{\"t\":\"num\",\"v\":";
  if (!std::isfinite(v)) quote(o, std::isnan(v) ? "nan" : (v > 0 ? "inf" : "-inf"));
  else { char buf[32]; std::snprintf(buf, sizeof buf, "%.10g", static_cast<double>(v)); o += buf; }
  o += '}';
}

template <class T, std::enable_if_t<std::is_same_v<T, const char*> || std::is_same_v<T, char*>, int> = 0>
void dump(std::string& o, int, const T& v, High) {
  if (!v) { o += "{\"t\":\"none\"}"; return; }
  str(o, std::string_view(v));
}

template <class Tr, class A> void dump(std::string& o, int, const std::basic_string<char, Tr, A>& s, High) { str(o, s); }

template <class It> void seq(std::string& o, int depth, const char* kind, It first, It last, std::size_t size) {
  if (depth >= kMaxDepth) { o += "{\"t\":\"cut\"}"; return; }
  o += "{\"t\":\"list\",\"kind\":\"";
  o += kind;
  o += "\",\"items\":[";
  std::size_t i = 0;
  for (; first != last && i < kMaxItems; ++first, ++i) {
    if (i) o += ',';
    dump(o, depth + 1, *first, High{});
  }
  o += ']';
  if (size > kMaxItems) { o += ",\"more\":"; o += std::to_string(size - kMaxItems); }
  o += '}';
}

template <class It> void setlike(std::string& o, int depth, It first, It last, std::size_t size) {
  if (depth >= kMaxDepth) { o += "{\"t\":\"cut\"}"; return; }
  o += "{\"t\":\"set\",\"items\":[";
  std::size_t i = 0;
  for (; first != last && i < kMaxItems; ++first, ++i) {
    if (i) o += ',';
    dump(o, depth + 1, *first, High{});
  }
  o += ']';
  if (size > kMaxItems) { o += ",\"more\":"; o += std::to_string(size - kMaxItems); }
  o += '}';
}

template <class It> void maplike(std::string& o, int depth, It first, It last, std::size_t size) {
  if (depth >= kMaxDepth) { o += "{\"t\":\"cut\"}"; return; }
  o += "{\"t\":\"map\",\"entries\":[";
  std::size_t i = 0;
  for (; first != last && i < kMaxItems; ++first, ++i) {
    if (i) o += ',';
    o += '[';
    dump(o, depth + 1, first->first, High{});
    o += ',';
    dump(o, depth + 1, first->second, High{});
    o += ']';
  }
  o += ']';
  if (size > kMaxItems) { o += ",\"more\":"; o += std::to_string(size - kMaxItems); }
  o += '}';
}

template <class T, class A> void dump(std::string& o, int d, const std::vector<T, A>& v, High) { seq(o, d, "vector", v.begin(), v.end(), v.size()); }
template <class A> void dump(std::string& o, int d, const std::vector<bool, A>& v, High) {
  std::vector<int> bits;
  if (d >= kMaxDepth) { o += "{\"t\":\"cut\"}"; return; }
  o += "{\"t\":\"list\",\"kind\":\"vector\",\"items\":[";
  std::size_t i = 0;
  for (auto it = v.begin(); it != v.end() && i < kMaxItems; ++it, ++i) {
    if (i) o += ',';
    const bool bit = *it;
    dump(o, d + 1, bit, High{});
  }
  o += ']';
  if (v.size() > kMaxItems) { o += ",\"more\":"; o += std::to_string(v.size() - kMaxItems); }
  o += '}';
}
template <class T, std::size_t N> void dump(std::string& o, int d, const std::array<T, N>& v, High) { seq(o, d, "array", v.begin(), v.end(), N); }
template <class T, std::size_t N> void dump(std::string& o, int d, const T (&v)[N], High) { seq(o, d, "array", v, v + N, N); }
template <class T, class A> void dump(std::string& o, int d, const std::deque<T, A>& v, High) { seq(o, d, "deque", v.begin(), v.end(), v.size()); }
template <class K, class V, class C, class A> void dump(std::string& o, int d, const std::map<K, V, C, A>& m, High) { maplike(o, d, m.begin(), m.end(), m.size()); }
template <class K, class V, class H, class E, class A> void dump(std::string& o, int d, const std::unordered_map<K, V, H, E, A>& m, High) { maplike(o, d, m.begin(), m.end(), m.size()); }
template <class T, class C, class A> void dump(std::string& o, int d, const std::set<T, C, A>& s, High) { setlike(o, d, s.begin(), s.end(), s.size()); }
template <class T, class H, class E, class A> void dump(std::string& o, int d, const std::unordered_set<T, H, E, A>& s, High) { setlike(o, d, s.begin(), s.end(), s.size()); }
template <class A, class B> void dump(std::string& o, int d, const std::pair<A, B>& p, High) {
  if (d >= kMaxDepth) { o += "{\"t\":\"cut\"}"; return; }
  o += "{\"t\":\"list\",\"kind\":\"tuple\",\"items\":[";
  dump(o, d + 1, p.first, High{});
  o += ',';
  dump(o, d + 1, p.second, High{});
  o += "]}";
}
// stack and queue keep their container in the protected member c; read it without copying.
template <class T, class C> struct StackAccess : std::stack<T, C> { static const C& of(const std::stack<T, C>& s) { return s.*(&StackAccess::c); } };
template <class T, class C> struct QueueAccess : std::queue<T, C> { static const C& of(const std::queue<T, C>& q) { return q.*(&QueueAccess::c); } };
template <class T, class C> void dump(std::string& o, int d, const std::stack<T, C>& s, High) { const C& c = StackAccess<T, C>::of(s); seq(o, d, "stack", c.begin(), c.end(), c.size()); }
template <class T, class C> void dump(std::string& o, int d, const std::queue<T, C>& q, High) { const C& c = QueueAccess<T, C>::of(q); seq(o, d, "queue", c.begin(), c.end(), c.size()); }

struct Vars {
  std::string json = "{";
  bool empty = true;
  template <class T> void var(const char* name, const T& value) {
    if (!empty) json += ',';
    empty = false;
    quote(json, name);
    json += ':';
    dump(json, 0, value, High{});
  }
};

struct Frame { const char* fn; int line; std::string locals; };
inline std::vector<Frame>& frames() { static std::vector<Frame> stack; return stack; }
inline long& step_count() { static long count = 0; return count; }
inline std::chrono::steady_clock::time_point started() { static const auto at = std::chrono::steady_clock::now(); return at; }

inline void emit(const std::string& text) {
  std::size_t off = 0;
  while (off < text.size()) {
    const ssize_t n = ::write(3, text.data() + off, text.size() - off);
    if (n <= 0) return;
    off += static_cast<std::size_t>(n);
  }
}
inline void flush_output() { std::cout.flush(); std::cerr.flush(); std::fflush(stdout); std::fflush(stderr); }
[[noreturn]] inline void finish(const char* reason) {
  flush_output();
  std::string line = "{\"end\":\"";
  line += reason;
  line += "\"}\n";
  emit(line);
  std::_Exit(0);
}

struct FrameGuard {
  FrameGuard(const char* fn, int line) { started(); frames().push_back(Frame{fn, line, "{}"}); }
  ~FrameGuard() { frames().pop_back(); }
  FrameGuard(const FrameGuard&) = delete;
  FrameGuard& operator=(const FrameGuard&) = delete;
};

template <class F> void step(int line, F&& collect) {
  if (frames().empty()) return;
  if (++step_count() > kMaxSteps) finish("steps");
  if (std::chrono::duration<double>(std::chrono::steady_clock::now() - started()).count() > kMaxSeconds) finish("time");
  Vars vars;
  collect(vars);
  vars.json += '}';
  Frame& top = frames().back();
  top.line = line;
  top.locals = std::move(vars.json);
  flush_output();
  std::string record = "{\"line\":";
  record += std::to_string(line);
  record += ",\"stack\":[";
  for (std::size_t i = 0; i < frames().size(); ++i) {
    const Frame& f = frames()[i];
    if (i) record += ',';
    record += "{\"fn\":";
    quote(record, f.fn);
    record += ",\"line\":";
    record += std::to_string(f.line);
    record += ",\"locals\":";
    record += f.locals;
    record += '}';
  }
  record += "]}\n";
  emit(record);
}
}  // namespace __pl
`;

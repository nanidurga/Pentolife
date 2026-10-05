import type { Language } from "@/lib/viz/engines";

export type Template = { id: string; name: string; code: string; stdin?: string };

const py = (id: string, name: string, code: string): Template => ({ id, name, code: code.trimStart() });

export const TEMPLATES: Record<Language, Template[]> = {
  python: [
    py("bubble-sort", "Bubble sort", `
def bubble_sort(a):
    n = len(a)
    for i in range(n):
        for j in range(n - i - 1):
            if a[j] > a[j + 1]:
                a[j], a[j + 1] = a[j + 1], a[j]
    return a

print(bubble_sort([5, 1, 4, 2, 8]))
`),
    py("binary-search", "Binary search", `
def binary_search(nums, target):
    lo, hi = 0, len(nums) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if nums[mid] == target:
            return mid
        if nums[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1

print(binary_search([1, 3, 5, 7, 9, 11, 13], 9))
`),
    py("two-sum", "Two sum (hash map)", `
def two_sum(nums, target):
    seen = {}
    for i, x in enumerate(nums):
        need = target - x
        if need in seen:
            return [seen[need], i]
        seen[x] = i
    return []

print(two_sum([2, 7, 11, 15], 9))
`),
    py("two-pointers", "Two pointers: most water", `
def max_area(height):
    left, right = 0, len(height) - 1
    best = 0
    while left < right:
        area = min(height[left], height[right]) * (right - left)
        best = max(best, area)
        if height[left] < height[right]:
            left += 1
        else:
            right -= 1
    return best

print(max_area([1, 8, 6, 2, 5, 4, 8, 3, 7]))
`),
    py("recursion", "Recursion: fibonacci", `
def fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)

print(fib(5))
`),
    py("bfs-grid", "BFS on a grid", `
from collections import deque

def shortest_path(grid):
    rows, cols = len(grid), len(grid[0])
    dist = [[-1] * cols for _ in range(rows)]
    dist[0][0] = 0
    queue = deque([(0, 0)])
    while queue:
        r, c = queue.popleft()
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < rows and 0 <= nc < cols and grid[nr][nc] == 0 and dist[nr][nc] == -1:
                dist[nr][nc] = dist[r][c] + 1
                queue.append((nr, nc))
    return dist[rows - 1][cols - 1]

print(shortest_path([[0, 0, 1], [1, 0, 0], [0, 0, 0]]))
`),
    py("merge-sort", "Merge sort", `
def merge_sort(a):
    if len(a) <= 1:
        return a
    mid = len(a) // 2
    left = merge_sort(a[:mid])
    right = merge_sort(a[mid:])
    merged = []
    i = j = 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:
            merged.append(left[i])
            i += 1
        else:
            merged.append(right[j])
            j += 1
    merged.extend(left[i:])
    merged.extend(right[j:])
    return merged

print(merge_sort([38, 27, 43, 3, 9, 82, 10]))
`),
    py("linked-list", "Reverse a linked list", `
class Node:
    def __init__(self, val, next=None):
        self.val = val
        self.next = next

def reverse(head):
    prev = None
    curr = head
    while curr:
        nxt = curr.next
        curr.next = prev
        prev = curr
        curr = nxt
    return prev

head = reverse(Node(1, Node(2, Node(3, Node(4)))))
values = []
while head:
    values.append(head.val)
    head = head.next
print(values)
`),
  ],
  cpp: [
    py("bubble-sort", "Bubble sort", `
#include <iostream>
#include <vector>
using namespace std;

int main() {
    vector<int> a = {5, 1, 4, 2, 8};
    int n = a.size();
    for (int i = 0; i < n; i++)
        for (int j = 0; j + 1 < n - i; j++)
            if (a[j] > a[j + 1]) swap(a[j], a[j + 1]);
    for (int x : a) cout << x << ' ';
    cout << endl;
}
`),
    py("binary-search", "Binary search", `
#include <iostream>
#include <vector>
using namespace std;

int binarySearch(const vector<int>& nums, int target) {
    int lo = 0, hi = nums.size() - 1;
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2;
        if (nums[mid] == target) return mid;
        if (nums[mid] < target) lo = mid + 1;
        else hi = mid - 1;
    }
    return -1;
}

int main() {
    vector<int> nums = {1, 3, 5, 7, 9, 11, 13};
    cout << binarySearch(nums, 9) << endl;
}
`),
    py("two-sum", "Two sum (hash map)", `
#include <iostream>
#include <unordered_map>
#include <vector>
using namespace std;

vector<int> twoSum(const vector<int>& nums, int target) {
    unordered_map<int, int> seen;
    for (int i = 0; i < (int)nums.size(); i++) {
        int need = target - nums[i];
        if (seen.count(need)) return {seen[need], i};
        seen[nums[i]] = i;
    }
    return {};
}

int main() {
    vector<int> ans = twoSum({2, 7, 11, 15}, 9);
    cout << ans[0] << ' ' << ans[1] << endl;
}
`),
    py("two-pointers", "Two pointers: most water", `
#include <algorithm>
#include <iostream>
#include <vector>
using namespace std;

int maxArea(const vector<int>& height) {
    int left = 0, right = height.size() - 1, best = 0;
    while (left < right) {
        int area = min(height[left], height[right]) * (right - left);
        best = max(best, area);
        if (height[left] < height[right]) left++;
        else right--;
    }
    return best;
}

int main() {
    cout << maxArea({1, 8, 6, 2, 5, 4, 8, 3, 7}) << endl;
}
`),
    py("recursion", "Recursion: fibonacci", `
#include <iostream>
using namespace std;

int fib(int n) {
    if (n < 2) return n;
    return fib(n - 1) + fib(n - 2);
}

int main() {
    cout << fib(5) << endl;
}
`),
    py("bfs-grid", "BFS on a grid", `
#include <iostream>
#include <queue>
#include <utility>
#include <vector>
using namespace std;

int shortestPath(const vector<vector<int>>& grid) {
    int rows = grid.size(), cols = grid[0].size();
    vector<vector<int>> dist(rows, vector<int>(cols, -1));
    queue<pair<int, int>> q;
    dist[0][0] = 0;
    q.push({0, 0});
    int dr[] = {1, -1, 0, 0}, dc[] = {0, 0, 1, -1};
    while (!q.empty()) {
        auto [r, c] = q.front();
        q.pop();
        for (int d = 0; d < 4; d++) {
            int nr = r + dr[d], nc = c + dc[d];
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr][nc] == 0 && dist[nr][nc] == -1) {
                dist[nr][nc] = dist[r][c] + 1;
                q.push({nr, nc});
            }
        }
    }
    return dist[rows - 1][cols - 1];
}

int main() {
    vector<vector<int>> grid = {{0, 0, 1}, {1, 0, 0}, {0, 0, 0}};
    cout << shortestPath(grid) << endl;
}
`),
    py("merge-sort", "Merge sort", `
#include <iostream>
#include <vector>
using namespace std;

void mergeSort(vector<int>& a, int lo, int hi) {
    if (hi - lo <= 1) return;
    int mid = (lo + hi) / 2;
    mergeSort(a, lo, mid);
    mergeSort(a, mid, hi);
    vector<int> merged;
    int i = lo, j = mid;
    while (i < mid && j < hi) {
        if (a[i] <= a[j]) merged.push_back(a[i++]);
        else merged.push_back(a[j++]);
    }
    while (i < mid) merged.push_back(a[i++]);
    while (j < hi) merged.push_back(a[j++]);
    for (int k = 0; k < (int)merged.size(); k++) a[lo + k] = merged[k];
}

int main() {
    vector<int> a = {38, 27, 43, 3, 9, 82, 10};
    mergeSort(a, 0, a.size());
    for (int x : a) cout << x << ' ';
    cout << endl;
}
`),
    py("balanced-brackets", "Stack: balanced brackets", `
#include <iostream>
#include <stack>
#include <string>
using namespace std;

bool isValid(const string& s) {
    stack<char> st;
    for (char ch : s) {
        if (ch == '(' || ch == '[' || ch == '{') {
            st.push(ch);
        } else {
            if (st.empty()) return false;
            char open = st.top();
            st.pop();
            if ((ch == ')' && open != '(') || (ch == ']' && open != '[') || (ch == '}' && open != '{')) return false;
        }
    }
    return st.empty();
}

int main() {
    cout << boolalpha << isValid("{[()()]}") << endl;
}
`),
  ],
};

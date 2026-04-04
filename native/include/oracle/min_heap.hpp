#pragma once

#include <algorithm>
#include <functional>
#include <vector>

namespace oracle {

/** Min-heap with explicit key function (matches TS MinHeap). */
template <class T, class KeyFn>
class MinHeap {
 public:
  explicit MinHeap(KeyFn key_fn) : key_fn_(std::move(key_fn)) {}

  std::size_t size() const { return data_.size(); }
  bool empty() const { return data_.empty(); }

  const T& peek() const { return data_.front(); }

  void push(const T& item) {
    data_.push_back(item);
    sift_up(data_.size() - 1);
  }

  void push(T&& item) {
    data_.push_back(std::move(item));
    sift_up(data_.size() - 1);
  }

  T pop() {
    T min = std::move(data_.front());
    T last = std::move(data_.back());
    data_.pop_back();
    if (!data_.empty()) {
      data_[0] = std::move(last);
      sift_down(0);
    }
    return min;
  }

  std::vector<T> snapshot_sorted() const {
    std::vector<T> out = data_;
    std::sort(out.begin(), out.end(),
              [this](const T& a, const T& b) { return key_fn_(a) < key_fn_(b); });
    return out;
  }

  void clear() { data_.clear(); }

 private:
  std::vector<T> data_;
  KeyFn key_fn_;

  void sift_up(std::size_t i) {
    while (i > 0) {
      const std::size_t p = (i - 1) >> 1;
      if (key_fn_(data_[i]) >= key_fn_(data_[p])) {
        break;
      }
      std::swap(data_[i], data_[p]);
      i = p;
    }
  }

  void sift_down(std::size_t i) {
    const std::size_t n = data_.size();
    for (;;) {
      const std::size_t l = i * 2 + 1;
      const std::size_t r = l + 1;
      std::size_t smallest = i;
      if (l < n && key_fn_(data_[l]) < key_fn_(data_[smallest])) {
        smallest = l;
      }
      if (r < n && key_fn_(data_[r]) < key_fn_(data_[smallest])) {
        smallest = r;
      }
      if (smallest == i) {
        break;
      }
      std::swap(data_[i], data_[smallest]);
      i = smallest;
    }
  }
};

}  // namespace oracle

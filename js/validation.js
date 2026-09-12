/**
 * validation.js — the browser copy of the quantity rules.
 * It exists to give warehouse staff an answer before they tap Save.
 * The identical checks run again in Apps Script, which is the real gate.
 */
window.Validate = (function () {

  /** Whole number, zero or above. Returns null when the value is unusable. */
  function wholeQty(value) {
    if (value === '' || value === null || value === undefined) return 0;
    var n = Number(value);
    if (isNaN(n)) return null;
    if (n < 0) return null;
    if (Math.floor(n) !== n) return null;
    return n;
  }

  /**
   * Checks one return line.
   * Returns { valid, remaining, errors: {field: message}, message }
   */
  function item(line) {
    var errors = {};
    var returnQty = wholeQty(line.returnQty);
    if (returnQty === null) errors.returnQty = 'Use a whole number, zero or more.';
    else if (returnQty < 1) errors.returnQty = 'Return quantity must be at least 1.';

    if (!line.productId) errors.productId = 'Pick a product.';

    if (!line.inspected) {
      return { valid: Object.keys(errors).length === 0, remaining: returnQty || 0, errors: errors, message: '' };
    }

    var ok = wholeQty(line.okQty);
    var repair = wholeQty(line.repairQty);
    var damaged = wholeQty(line.damagedQty);
    if (ok === null) errors.okQty = 'Whole numbers only.';
    if (repair === null) errors.repairQty = 'Whole numbers only.';
    if (damaged === null) errors.damagedQty = 'Whole numbers only.';

    var message = '';
    var remaining = 0;

    if (!errors.okQty && !errors.repairQty && !errors.damagedQty && !errors.returnQty) {
      var sum = ok + repair + damaged;
      remaining = returnQty - sum;
      if (ok > returnQty || repair > returnQty || damaged > returnQty) {
        message = 'A status quantity cannot be more than the return quantity.';
      } else if (remaining !== 0) {
        message = 'Status quantities must equal total return quantity.';
      }

      var production = wholeQty(line.productionQty);
      if (production === null) errors.productionQty = 'Whole numbers only.';
      else if (production > damaged) {
        errors.productionQty = 'Production cannot be more than the damaged quantity (' + damaged + ').';
      }
    }

    return {
      valid: Object.keys(errors).length === 0 && !message,
      remaining: remaining,
      errors: errors,
      message: message
    };
  }

  /** Whole-form check across every line. */
  function form(header, lines) {
    var errors = {};
    if (!header.returnDate) errors.returnDate = 'Pick the return date.';
    else if (header.returnDate > todayStr()) errors.returnDate = 'The return date cannot be in the future.';
    if (!header.source) errors.source = 'Choose where the return came from.';
    if (header.requireOrderId && !header.orderId) errors.orderId = 'Order ID is required.';
    if (!lines.length) errors.items = 'Add at least one product.';

    var lineResults = lines.map(item);
    var allLinesValid = lineResults.every(function (r) { return r.valid; });

    return {
      valid: Object.keys(errors).length === 0 && allLinesValid,
      errors: errors,
      lines: lineResults
    };
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /** Paints or clears an inline field error. */
  function mark(input, message) {
    if (!input) return;
    var field = input.closest('.field') || input.closest('.qty-box') || input.parentElement;
    var existing = field ? field.querySelector('.error') : null;
    if (message) {
      input.setAttribute('aria-invalid', 'true');
      if (!existing) {
        var span = document.createElement('span');
        span.className = 'error';
        span.textContent = message;
        field.appendChild(span);
      } else existing.textContent = message;
    } else {
      input.removeAttribute('aria-invalid');
      if (existing) existing.remove();
    }
  }

  return { item: item, form: form, wholeQty: wholeQty, mark: mark };
})();

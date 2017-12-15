'use strict';

module.exports = function DynamoQS(options) {
  const opts = options || {};

  this.ops = opts.ops || ['!', '^', '$', '>', '<', 'in', 'null'];
  this.alias = opts.alias || {};
  this.blacklist = opts.blacklist || {};
  this.whitelist = opts.whitelist || {};
  this.custom = opts.custom || {};

  // String Value Parsing
  opts.string = opts.string || {};
  this.string = opts.string || {};
  this.string.toBoolean = (typeof opts.string.toBoolean === 'boolean') ? opts.string.toBoolean : true;
  this.string.toNumber = (typeof opts.string.toNumber === 'boolean') ? opts.string.toNumber : true;

  this.keyRegex = opts.keyRegex || /^[a-zæøå0-9-_.]+$/i;
  this.valRegex = opts.valRegex || /[^a-zæøå0-9-_.* ]/i;
  this.arrRegex = opts.arrRegex || /^[a-zæøå0-9-_.]+(\[])?$/i;

  if (this.custom.after) {
    this.custom.after = this.customAfter(this.custom.after);
  }

  if (this.custom.before) {
    this.custom.before = this.customBefore(this.custom.before);
  }

  if (this.custom.between) {
    this.custom.between = this.customBetween(this.custom.between);
  }


  return this;
};

function parseDate(value) {
  let date = value;

  if (!isNaN(date)) {
    if (`${date}`.length === 10) {
      date = `${date}000`;
    }
    date = parseInt(date, 10);
  }

  date = new Date(date);

  return date;
}

module.exports.prototype.customAfter = field => (query, value) => {
  const date = parseDate(value);

  if (date.toString() !== 'Invalid Date') {
    query[field] = {
      ge: date.toISOString(),
    };
  }
};

module.exports.prototype.customBefore = field => (query, value) => {
  const date = parseDate(value);

  if (date.toString() !== 'Invalid Date') {
    query[field] = {
      lt: date.toISOString(),
    };
  }
};

module.exports.prototype.customBetween = field => (query, value) => {
  const dates = value.split('|');
  const afterValue = dates[0];
  const beforeValue = dates[1];

  const after = parseDate(afterValue);
  const before = parseDate(beforeValue);

  if (after.toString() !== 'Invalid Date' && before.toString() !== 'Invalid Date') {
    query[field] = {
      ge: after.toISOString(),
      lt: before.toISOString(),
    };
  }
};

module.exports.prototype.parseString = function parseString(string, array) {
  let op = string[0] || '';
  const eq = string[1] === '=';
  let org = string.substr(eq ? 2 : 1) || '';
  const val = this.parseStringVal(org);

  const ret = { op, org, value: val };

  switch (op) {
    case '!':
      if (array) {
        ret.field = 'not_contains'; // DynamodDB Documentation
        // ret.field = 'not in'; // Dynamoose Documentation
      } else if (org === '') {
        ret.field = 'not_null'; // DynamodDB Documentation
        // ret.field = 'not null'; // Dynamoose Documentation
        ret.value = false;
      } else {
        ret.field = 'ne'; // DynamodDB Documentation
        // ret.field = 'not'; // Dynamoose Documentation
      }
      break;
    case '>':
      ret.field = eq ? 'ge' : 'gt';
      break;
    case '<':
      ret.field = eq ? 'le' : 'lt';
      break;
    case '^':
      ret.field = 'begins_with'; // DynamodDB Documentation
      // ret.field = 'beginsWith'; // Dynamoose Documentation
      break;
    case '$':
      ret.field = 'contains'; // DynamodDB Documentation
      break;
    default:
      ret.org = org = op + org;
      ret.op = op = '';
      ret.value = this.parseStringVal(org);

      if (array) {
        ret.field = 'in';
      } else if (org === '') {
        ret.field = 'not_null'; // DynamodDB Documentation
        // ret.field = 'not null'; // Dynamoose Documentation
        ret.value = true;
      } else {
        ret.field = 'eq';
      }
  }

  ret.parsed = {};
  ret.parsed[ret.field] = ret.value;

  if (ret.options) {
    ret.parsed.$options = ret.options;
  }

  return ret;
};

module.exports.prototype.parseStringVal = function parseStringVal(string) {
  if (this.string.toBoolean && string.toLowerCase() === 'true') {
    return true;
  } else if (this.string.toBoolean && string.toLowerCase() === 'false') {
    return false;
  } else if (this.string.toNumber && !isNaN(parseInt(string, 10)) &&
      ((+string - +string) + 1) >= 0) {
    return parseFloat(string, 10);
  }

  return string;
};

module.exports.prototype.parse = function parse(query) {
  const res = {};

  Object.keys(query).forEach((k) => {
    let key = k;
    const val = query[key];

    // normalize array keys
    if (val instanceof Array) {
      key = key.replace(/\[]$/, '');
    }

    // whitelist
    if (Object.keys(this.whitelist).length && !this.whitelist[key]) {
      return;
    }

    // blacklist
    if (this.blacklist[key]) {
      return;
    }

    // alias
    if (this.alias[key]) {
      key = this.alias[key];
    }

    // string key
    if (typeof val === 'string' && !this.keyRegex.test(key)) {
      return;

    // array key
    } else if (val instanceof Array && !this.arrRegex.test(key)) {
      return;
    }

    // custom functions
    if (typeof this.custom[key] === 'function') {
      this.custom[key].apply(null, [res, val]);
      return;
    }

    // array key
    if (val instanceof Array) {
      if (this.ops.indexOf('in') >= 0 && val.length > 0) {
        res[key] = {};

        for (let i = 0; i < val.length; i += 1) {
          if (this.ops.indexOf(val[i][0]) >= 0) {
            const parsed = this.parseString(val[i], true);

            switch (parsed.field) {
              case 'in':
              case 'not_contains':
                res[key][parsed.field] = res[key][parsed.field] || [];
                res[key][parsed.field].push(parsed.value);
                break;
              default:
                res[key][parsed.field] = parsed.value;
            }
          } else {
            res[key].in = res[key].in || [];
            res[key].in.push(this.parseStringVal(val[i]));
          }
        }
      }

      return;
    }

    // value must be a string
    if (typeof val !== 'string') {
      return;
    }

    // field exists query
    if (!val) {
      res[key] = { not_null: true };

    // query operators
    } else if (this.ops.indexOf(val[0]) >= 0) {
      res[key] = this.parseString(val).parsed;

    // equal operator (no operator)
    } else {
      res[key] = this.parseStringVal(val);
    }
  });

  return res;
};

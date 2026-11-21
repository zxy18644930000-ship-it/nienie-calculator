const { pad2 } = require('./util');
const store = require('./store');
const fs = wx.getFileSystemManager();

function fileToDataURL(path) {
  return new Promise((resolve, reject) => {
    fs.readFile({
      filePath: path,
      encoding: 'base64',
      success: (res) => resolve('data:image/jpeg;base64,' + res.data),
      fail: reject,
    });
  });
}

async function exportBackup() {
  wx.showLoading({ title: '打包中…' });
  try {
    const items = store.loadItems();
    const records = store.loadRecords();
    const discounts = store.loadDiscounts();
    const images = {};
    for (const it of items) {
      if (!it.hasImg || !it.imgPath) continue;
      try { images[it.id] = await fileToDataURL(it.imgPath); } catch (e) {}
    }
    const data = {
      app: 'nienie-calculator',
      version: 1,
      exportedAt: new Date().toISOString(),
      items,
      records,
      discounts,
      images,
    };
    const d = new Date();
    const name = '捏捏乐备份-' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' + pad2(d.getHours()) + pad2(d.getMinutes()) + '.json';
    const path = wx.env.USER_DATA_PATH + '/' + name;
    fs.writeFileSync(path, JSON.stringify(data), 'utf8');
    wx.hideLoading();
    wx.shareFileMessage({
      filePath: path,
      fail: () => {
        wx.showToast({ title: '已生成备份文件', icon: 'none' });
      },
    });
  } catch (e) {
    wx.hideLoading();
    wx.showToast({ title: '导出失败，稍后再试', icon: 'none' });
  }
}

function chooseAndReadBackup(callback) {
  wx.chooseMessageFile({
    count: 1,
    type: 'file',
    success: (res) => {
      const f = res.tempFiles[0];
      fs.readFile({
        filePath: f.path,
        encoding: 'utf8',
        success: (r) => {
          let data = null;
          try { data = JSON.parse(r.data); } catch (e) {}
          if (!data || data.app !== 'nienie-calculator' || !Array.isArray(data.items)) {
            wx.showToast({ title: '这不是捏捏乐备份文件', icon: 'none' });
            return;
          }
          callback(data);
        },
        fail: () => wx.showToast({ title: '文件读取失败', icon: 'none' }),
      });
    },
  });
}

function applyImport(data, done) {
  wx.showLoading({ title: '恢复中…' });
  try {
    const oldItems = store.loadItems();
    for (const it of oldItems) store.deleteImage(it.imgPath);

    const items = store.normalizeItems(data.items);
    const records = Array.isArray(data.records) ? data.records : [];
    const discounts = store.normalizeDiscounts(data.discounts);
    const images = data.images || {};

    for (const it of items) {
      const durl = images[it.id];
      if (it.hasImg && typeof durl === 'string' && durl.indexOf('base64,') >= 0) {
        const b64 = durl.slice(durl.indexOf('base64,') + 7);
        const dest = wx.env.USER_DATA_PATH + '/img_' + it.id + '_' + Date.now() + '.jpg';
        try {
          fs.writeFileSync(dest, b64, 'base64');
          it.imgPath = dest;
          it.hasImg = true;
        } catch (e) {
          it.hasImg = false;
          it.imgPath = '';
        }
      } else {
        it.hasImg = false;
        it.imgPath = '';
      }
    }

    store.saveItems(items);
    store.saveRecords(records);
    store.saveDiscounts(discounts);
    wx.hideLoading();
    if (done) done();
  } catch (e) {
    wx.hideLoading();
    wx.showToast({ title: '导入出错了', icon: 'none' });
  }
}

module.exports = { exportBackup, chooseAndReadBackup, applyImport };
